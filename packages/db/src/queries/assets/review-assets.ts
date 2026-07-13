import { AssetValidationError, assetEditSchema, isEmptyAssetEdit } from "@tendnote/domain";
import { recordAudit, resolveAssetVisibility, writeAssetShares } from "./lifecycle";
import {
  buildGroupResult,
  dismissMemory,
  listPendingMemories,
  requireGroupForAsset,
  requireSuggestedAsset,
  SET_ASIDE,
} from "./review-shared";
import type {
  AcceptSuggestedAssetInput,
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  EditSuggestedAssetInput,
  SuggestedAssetActionInput,
} from "./review-types";
import type { AssetPatch } from "./types";

/**
 * Reviewing a Suggested Asset (#198): accept promotes the same row in place,
 * edit corrects it while it stays a proposal, dismiss resolves it to a husk and
 * cascades its pending details. All owner-only — a proposal is never another
 * member's to review.
 */

/** Applies an accept-time audience choice, writing shares for a selected one. */
async function applyAcceptScope(
  store: AssetReviewLifecycleStore,
  input: AcceptSuggestedAssetInput,
  patch: AssetPatch,
): Promise<void> {
  if (input.scope === undefined) {
    return; // Keep the scope the proposal argued for.
  }
  const { scope, householdId } = await resolveAssetVisibility(store, {
    ownerUserId: input.actorUserId,
    scope: input.scope,
    householdId: input.householdId,
    selectedUserIds: input.selectedUserIds,
  });
  patch.scope = scope;
  patch.householdId = householdId;
  if (scope === "shared" && householdId) {
    await writeAssetShares(store, {
      householdId,
      assetId: input.assetId,
      ownerUserId: input.actorUserId,
      selectedUserIds: input.selectedUserIds ?? [],
    });
  }
}

/**
 * Accepts a Suggested Asset, promoting the same row in place to an active
 * Asset. An optional edit corrects name/kind first; an optional scope choice
 * finalizes the audience (including a selected-shared one a proposal cannot
 * carry). Idempotent: re-accepting a promoted proposal returns it unchanged; a
 * dismissed proposal is never silently promoted. Its pending memories stay
 * pending — accepting the anchor is deliberately not a batch accept.
 */
export async function acceptSuggestedAsset(
  store: AssetReviewLifecycleStore,
  input: AcceptSuggestedAssetInput,
): Promise<AssetReviewGroupResult> {
  const existing = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (!existing) {
    throw new Error("Asset not found.");
  }
  if (existing.status === "dismissed") {
    throw new Error(SET_ASIDE);
  }

  const group = await requireGroupForAsset(store, {
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (existing.status !== "suggested") {
    // Already promoted: a no-op that returns the durable state, so accepting
    // twice never creates a duplicate.
    return buildGroupResult(store, group);
  }

  const edit = assetEditSchema.parse(input.edit ?? {});
  const patch: AssetPatch = {
    status: "active",
    lastActorUserId: input.actorUserId,
    ...(edit.name !== undefined ? { name: edit.name } : {}),
    ...(edit.kind !== undefined ? { kind: edit.kind } : {}),
  };
  await applyAcceptScope(store, input, patch);

  const updated = await store.updateAsset({
    ownerUserId: existing.ownerUserId,
    assetId: existing.id,
    patch,
  });

  await recordAudit(store, updated, {
    kind: "promoted",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: {
      previousStatus: existing.status,
      status: updated.status,
      fromSuggestion: true,
      edited: !isEmptyAssetEdit(edit),
      sourceRecordId: group.sourceRecordId,
    },
  });

  return buildGroupResult(store, group);
}

/** Corrects a Suggested Asset's content in place, leaving it suggested. */
export async function editSuggestedAsset(
  store: AssetReviewLifecycleStore,
  input: EditSuggestedAssetInput,
): Promise<AssetReviewGroupResult> {
  const asset = await requireSuggestedAsset(store, input);
  const edit = assetEditSchema.parse(input.edit);
  if (isEmptyAssetEdit(edit)) {
    throw new AssetValidationError("An asset edit must change the name or kind.");
  }

  const updated = await store.updateAsset({
    ownerUserId: asset.ownerUserId,
    assetId: asset.id,
    patch: {
      lastActorUserId: input.actorUserId,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.kind !== undefined ? { kind: edit.kind } : {}),
    },
  });

  await recordAudit(store, updated, {
    kind: "edited",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: {
      reviewEdit: true,
      ...(edit.name !== undefined ? { nameFrom: asset.name, nameTo: edit.name } : {}),
      ...(edit.kind !== undefined ? { kindFrom: asset.kind, kindTo: edit.kind } : {}),
    },
  });

  return buildGroupResult(
    store,
    await requireGroupForAsset(store, { ownerUserId: input.actorUserId, assetId: asset.id }),
  );
}

/**
 * Dismisses a Suggested Asset — the user rejects the proposal. The row becomes
 * a `dismissed` husk (never visible anywhere), and its still-pending details
 * cascade to dismissed with it: rejecting the thing rejects its details. A
 * later capture can re-propose everything fresh.
 */
export async function dismissSuggestedAsset(
  store: AssetReviewLifecycleStore,
  input: SuggestedAssetActionInput,
): Promise<AssetReviewGroupResult> {
  const asset = await requireSuggestedAsset(store, input);
  const updated = await store.updateAsset({
    ownerUserId: asset.ownerUserId,
    assetId: asset.id,
    patch: { status: "dismissed", lastActorUserId: input.actorUserId },
  });
  await recordAudit(store, updated, {
    kind: "dismissed",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: { previousStatus: asset.status, status: updated.status, fromSuggestion: true },
  });

  const group = await requireGroupForAsset(store, {
    ownerUserId: input.actorUserId,
    assetId: asset.id,
  });
  for (const memory of await listPendingMemories(store, group)) {
    await dismissMemory(store, memory, {
      actorUserId: input.actorUserId,
      source: input.source,
      cascade: true,
    });
  }

  // Evidence captured for the rejected proposal goes with it — rows and bytes
  // both — so no invisible document bucket forms under a dismissed husk (#200).
  // The reviewer dismisses the card that *shows* this evidence, so nothing is
  // discarded sight unseen.
  for (const record of await store.listAssetEvidenceForOwner({
    ownerUserId: input.actorUserId,
    assetId: asset.id,
  })) {
    await store.deleteAssetEvidence({
      ownerUserId: record.ownerUserId,
      evidenceId: record.id,
    });
    await recordAudit(store, updated, {
      kind: "evidence_removed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { evidenceId: record.id, kind: record.kind, label: record.label, cascade: true },
    });
  }

  return buildGroupResult(store, group);
}
