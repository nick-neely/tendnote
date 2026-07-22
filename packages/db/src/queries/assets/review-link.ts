import { type Asset, AssetValidationError, isDurableAssetStatus } from "@tendnote/domain";
import { recordAudit } from "./lifecycle";
import { buildGroupResult, listPendingMemories, loadAnchor, requireGroup } from "./review-shared";
import type {
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  LinkAssetReviewGroupInput,
} from "./review-types";
import {
  replaceReanchoredAssetChildShares,
  resolveReanchoredAssetChildVisibility,
} from "./review-visibility";

/**
 * Duplicate review's link-to-existing resolution (#198): instead of promoting a
 * near-duplicate Suggested Asset, the group re-anchors onto an Asset the caller
 * already tracks. Full Asset merge is deliberately deferred (#196) — this only
 * redirects still-pending proposals, never durable records.
 */

/** Loads and vets the link target: visible, active, and not the proposal itself. */
async function requireLinkTarget(
  store: AssetReviewLifecycleStore,
  input: LinkAssetReviewGroupInput,
  anchor: Asset,
): Promise<Asset> {
  if (input.targetAssetId === anchor.id) {
    throw new AssetValidationError("Choose a different asset to link to.");
  }
  const target = await loadAnchor(store, input.actorUserId, input.targetAssetId);
  if (!target || !isDurableAssetStatus(target.status)) {
    throw new Error("Asset not found.");
  }
  if (target.status !== "active") {
    throw new AssetValidationError("Link to an active asset. Restore it first.");
  }
  return target;
}

/** The would-be duplicate resolves to a husk; both trails record the link. */
async function resolveAnchorAsLinked(
  store: AssetReviewLifecycleStore,
  args: {
    input: LinkAssetReviewGroupInput;
    anchor: Asset;
    target: Asset;
    memoriesLinked: number;
    evidenceLinked: number;
    actionsLinked: number;
  },
): Promise<void> {
  const { input, anchor, target, memoriesLinked, evidenceLinked, actionsLinked } = args;
  const husk = await store.updateAsset({
    ownerUserId: anchor.ownerUserId,
    assetId: anchor.id,
    patch: { status: "dismissed", lastActorUserId: input.actorUserId },
  });
  await recordAudit(store, husk, {
    kind: "linked_existing",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: {
      targetAssetId: target.id,
      memoriesLinked,
      evidenceLinked,
      actionsLinked,
      resolvedAs: "link",
    },
  });
  await recordAudit(store, target, {
    kind: "linked_existing",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: { fromAssetId: anchor.id, memoriesLinked, evidenceLinked, actionsLinked },
  });
}

/**
 * Resolves duplicate review by linking the group to an existing Asset: the
 * pending details re-anchor to the target (visibility clamped, never widened),
 * the would-be duplicate row resolves to a dismissed husk, and both sides
 * record `linked_existing` in their audit trails.
 */
export async function linkAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  input: LinkAssetReviewGroupInput,
): Promise<AssetReviewGroupResult> {
  const group = await requireGroup(store, {
    ownerUserId: input.actorUserId,
    groupId: input.groupId,
  });
  const anchor = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: group.assetId,
  });
  if (anchor?.status !== "suggested") {
    throw new AssetValidationError(
      "Only a pending suggested asset can be linked to an existing one.",
    );
  }
  const target = await requireLinkTarget(store, input, anchor);

  const pending = await listPendingMemories(store, group);
  for (const memory of pending) {
    // Visibility is clamped to what the target allows — linking never widens.
    const visibility = await resolveReanchoredAssetChildVisibility(store, {
      child: memory,
      recordKind: "asset_memory",
      target,
    });
    await store.updateAssetMemory({
      ownerUserId: memory.ownerUserId,
      memoryId: memory.id,
      patch: {
        assetId: target.id,
        scope: visibility.scope,
        householdId: visibility.householdId,
        lastActorUserId: input.actorUserId,
      },
    });
    await replaceReanchoredAssetChildShares(store, {
      ...visibility,
      previousHouseholdId: memory.householdId,
      ownerUserId: memory.ownerUserId,
      recordKind: "asset_memory",
      recordId: memory.id,
    });
  }

  // The group's captured evidence rides along, under the same clamp (#200).
  const evidence = await store.listAssetEvidenceForOwner({
    ownerUserId: group.ownerUserId,
    reviewGroupId: group.id,
  });
  for (const record of evidence) {
    const visibility = await resolveReanchoredAssetChildVisibility(store, {
      child: record,
      recordKind: "asset_evidence",
      target,
    });
    await store.updateAssetEvidence({
      ownerUserId: record.ownerUserId,
      evidenceId: record.id,
      patch: {
        assetId: target.id,
        scope: visibility.scope,
        householdId: visibility.householdId,
        lastActorUserId: input.actorUserId,
      },
    });
    await replaceReanchoredAssetChildShares(store, {
      ...visibility,
      previousHouseholdId: record.householdId,
      ownerUserId: record.ownerUserId,
      recordKind: "asset_evidence",
      recordId: record.id,
    });
  }

  // Any General Actions whose hints resolved to the would-be duplicate follow
  // it onto the target — an already-linked action keeps its single link (#199).
  const actionsLinked = await store.repointGeneralActionAssetLinks({
    ownerUserId: anchor.ownerUserId,
    fromAssetId: anchor.id,
    toAssetId: target.id,
  });

  await resolveAnchorAsLinked(store, {
    input,
    anchor,
    target,
    memoriesLinked: pending.length,
    evidenceLinked: evidence.length,
    actionsLinked,
  });

  const updatedGroup = await store.updateAssetReviewGroupAsset({
    ownerUserId: group.ownerUserId,
    groupId: group.id,
    assetId: target.id,
  });
  return buildGroupResult(store, updatedGroup);
}
