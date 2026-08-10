import {
  type Asset,
  type AssetAuditSource,
  type AssetMemory,
  type AssetReviewGroup,
  AssetValidationError,
  canUseSensitiveContext,
  findAssetDuplicateCandidates,
  HouseholdRecordUnavailableError,
  isDurableAssetStatus,
  type PrivacyScope,
  type SourceRecord,
} from "@tendnote/domain";
import { createAssetAuthority, resolveOwnedOrVisible } from "./household-authority";
import { recordAudit } from "./lifecycle";
import type {
  AssetMemoryActionInput,
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  SuggestAssetMemoryContent,
  SuggestedAssetActionInput,
} from "./review-types";
import { resolveAssetChildVisibility, writeAssetChildShares } from "./review-visibility";

/**
 * Shared loaders, guards, and the result builder for the review-gated Asset
 * Memory seam (#198). Every review step module composes these so the review
 * invariants — owner-only proposals, mandatory grounding, durable anchors,
 * fail-closed denials — live in exactly one place. Module-scope on purpose
 * (fallow factory pattern): the `createAssetReview` factory stays thin and each
 * step stays an individually-measurable unit.
 */

export const SET_ASIDE = "This suggestion was set aside; propose it again to act on it.";
export const ACCEPT_ANCHOR_FIRST =
  "Accept the suggested asset first, or link it to an existing one.";
const ARCHIVED_ANCHOR = "This asset is archived. Restore it before adding details.";

/** Loads the mandatory grounding source and applies the restricted-context gate. */
export async function requireGrounding(
  store: AssetReviewLifecycleStore,
  input: { ownerUserId: string; sourceRecordId: string; directlyRequested?: boolean },
): Promise<SourceRecord> {
  const sourceRecord = await store.getSourceRecord({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
  });
  if (!sourceRecord) {
    throw new Error("An asset suggestion must be grounded in a source record.");
  }
  if (
    !canUseSensitiveContext({
      sensitivity: sourceRecord.sensitivity,
      directlyRequested: input.directlyRequested,
    })
  ) {
    throw new Error(
      "Restricted context isn't used for proactive asset suggestions unless you ask directly.",
    );
  }
  return sourceRecord;
}

/**
 * Opens a Suggested Asset proposal — the one shared write triple behind every
 * inferred or promoted asset proposal: the `suggested` asset row, its Asset
 * Review Group, and the `suggested` audit event with grounding provenance.
 * `suggestAsset` (#198), the action-hint bridge (#199), and evidence capture to
 * a new asset (#201) all route here so the proposal invariant never forks
 * between modules. Visibility must already be resolved
 * (`resolveAssetVisibility`); grounding may be null only for the
 * explicitly-exempt user-intent paths — the bridge's ungrounded promotion and
 * the capture flow where the user names the thing themselves.
 */
export async function openSuggestedAssetProposal(
  store: AssetReviewLifecycleStore,
  input: {
    ownerUserId: string;
    actorUserId: string;
    name: string;
    kind: Asset["kind"];
    scope: PrivacyScope;
    householdId: string | null;
    sourceRecordId: string | null;
    auditSource: AssetAuditSource;
    /** Extra provenance for the `suggested` audit event (per-caller fields). */
    auditDetail?: Record<string, unknown>;
  },
): Promise<{ asset: Asset; group: AssetReviewGroup }> {
  const asset = await store.createAsset({
    ownerUserId: input.ownerUserId,
    name: input.name,
    kind: input.kind,
    status: "suggested",
    scope: input.scope,
    householdId: input.householdId,
    archivedAt: null,
    createdByUserId: input.ownerUserId,
    lastActorUserId: input.actorUserId,
  });

  const group = await store.createAssetReviewGroup({
    ownerUserId: input.ownerUserId,
    assetId: asset.id,
    sourceRecordId: input.sourceRecordId,
  });

  await recordAudit(store, asset, {
    kind: "suggested",
    actorUserId: input.actorUserId,
    source: input.auditSource,
    detail: {
      name: asset.name,
      kind: asset.kind,
      scope: asset.scope,
      grounded: input.sourceRecordId !== null,
      reviewGroupId: group.id,
      ...input.auditDetail,
    },
  });

  return { asset, group };
}

/**
 * Loads a group's anchor asset for the caller: their own row (the common case,
 * including a pending proposal) or a scope-visible durable asset after duplicate
 * review linked to a co-member's — or after the workspace was handed one.
 *
 * The owner-keyed read is accepted only for a member-owned row, for the same
 * reason `findVisibleAsset` does it: a household-native Asset's `ownerUserId` is
 * a storage key, and treating it as an access path would keep its departed
 * creator reading the household's records (ADR 0214).
 */
export async function loadAnchor(
  store: AssetReviewLifecycleStore,
  ownerUserId: string,
  assetId: string,
): Promise<Asset | null> {
  return resolveOwnedOrVisible({
    owned: () => store.getAsset({ ownerUserId, assetId }),
    visible: () => store.getVisibleAsset({ callerUserId: ownerUserId, assetId }),
  });
}

/**
 * Loads a durable, active anchor for a child write and proves the caller may
 * attach to it, or throws fail-closed.
 *
 * `attach` asks the proof only for visibility, because the detail being written
 * is the caller's own and clamped to this Asset's scope — attaching a private
 * note to a partner's shared car is not an act on the car. What it *does* buy is
 * the freshness the SQL predicate cannot give: a member removed since the page
 * rendered is refused here rather than writing into a household they left
 * (ADR 0219).
 */
export async function requireActiveAnchor(
  store: AssetReviewLifecycleStore,
  input: { actorUserId: string; assetId: string },
): Promise<Asset> {
  const anchor = await loadAnchor(store, input.actorUserId, input.assetId);
  if (!anchor || !isDurableAssetStatus(anchor.status)) {
    throw new HouseholdRecordUnavailableError();
  }
  if (anchor.status !== "active") {
    throw new AssetValidationError(ARCHIVED_ANCHOR);
  }
  await createAssetAuthority(store).requireAssetAuthority({
    actorUserId: input.actorUserId,
    asset: anchor,
    operation: "attach",
  });
  return anchor;
}

/** Owner-keyed group load, or the deterministic denial. */
export async function requireGroup(
  store: AssetReviewLifecycleStore,
  input: { ownerUserId: string; groupId: string },
) {
  const group = await store.getAssetReviewGroup(input);
  if (!group) {
    throw new Error("Asset review group not found.");
  }
  return group;
}

/** The group behind a suggested asset row — every proposal is born with one. */
export async function requireGroupForAsset(
  store: AssetReviewLifecycleStore,
  input: { ownerUserId: string; assetId: string },
) {
  const group = await store.getAssetReviewGroupByAsset(input);
  if (!group) {
    throw new Error("Asset review group not found.");
  }
  return group;
}

/** Owner-keyed load of a still-pending Suggested Asset. */
export async function requireSuggestedAsset(
  store: AssetReviewLifecycleStore,
  input: SuggestedAssetActionInput,
): Promise<Asset> {
  const asset = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (!asset) {
    throw new Error("Asset not found.");
  }
  if (asset.status !== "suggested") {
    throw new AssetValidationError("Only a suggested asset can be reviewed.");
  }
  return asset;
}

/** Owner-keyed load of a still-pending Suggested Asset Memory. */
export async function requireSuggestedMemory(
  store: AssetReviewLifecycleStore,
  input: AssetMemoryActionInput,
): Promise<AssetMemory> {
  const memory = await store.getAssetMemory({
    ownerUserId: input.actorUserId,
    memoryId: input.memoryId,
  });
  if (!memory) {
    throw new Error("Asset memory not found.");
  }
  if (memory.status === "dismissed") {
    throw new Error(SET_ASIDE);
  }
  if (memory.status !== "suggested") {
    throw new AssetValidationError("Only a suggested detail can be reviewed.");
  }
  return memory;
}

/** The group's still-pending memories, owner-scoped, oldest first. */
export function listPendingMemories(
  store: AssetReviewLifecycleStore,
  group: { ownerUserId: string; id: string },
) {
  return store.listAssetMemoriesForOwner({
    ownerUserId: group.ownerUserId,
    reviewGroupId: group.id,
    statuses: ["suggested"],
  });
}

/**
 * Builds the group's review result: the anchor, its pending Suggested Asset
 * Memories, the deterministic duplicate candidates for a pending anchor
 * (computed at read time against the assets the owner can currently see, so a
 * just-created asset still raises the prompt), and the grounding source record.
 */
export async function buildGroupResult(
  store: AssetReviewLifecycleStore,
  group: {
    id: string;
    ownerUserId: string;
    assetId: string;
    sourceRecordId: string | null;
    createdAt: Date;
  },
): Promise<AssetReviewGroupResult> {
  const asset = await loadAnchor(store, group.ownerUserId, group.assetId);
  if (!asset) {
    throw new Error("Asset not found.");
  }
  const assetPending = asset.status === "suggested";

  const [memories, evidence, sourceRecord, existingAssets] = await Promise.all([
    listPendingMemories(store, group),
    store.listAssetEvidenceForOwner({
      ownerUserId: group.ownerUserId,
      reviewGroupId: group.id,
    }),
    group.sourceRecordId
      ? store.getSourceRecord({
          ownerUserId: group.ownerUserId,
          sourceRecordId: group.sourceRecordId,
        })
      : Promise.resolve(null),
    assetPending
      ? store.listVisibleAssetsForCaller({
          callerUserId: group.ownerUserId,
          statuses: ["active"],
        })
      : Promise.resolve([]),
  ]);

  return {
    group,
    asset,
    assetPending,
    memories,
    evidence,
    duplicateCandidates: assetPending
      ? findAssetDuplicateCandidates({
          name: asset.name,
          assets: existingAssets,
          excludeAssetId: asset.id,
        })
      : [],
    sourceRecord,
    component: {
      type: "asset_review_group",
      groupId: group.id,
      assetId: group.assetId,
      sourceRecordId: group.sourceRecordId,
    },
  };
}

/**
 * Persists one Suggested Asset Memory into a group: scope defaults to the
 * anchor's (where this slice supports it), the child-scope ceiling is enforced
 * fail-closed, and the write lands in the anchor's audit trail.
 */
export async function writeSuggestedMemory(
  store: AssetReviewLifecycleStore,
  input: {
    ownerUserId: string;
    anchor: Asset;
    groupId: string;
    sourceRecordId: string;
    content: SuggestAssetMemoryContent;
    auditSource: AssetAuditSource;
  },
): Promise<AssetMemory> {
  const visibility = await resolveAssetChildVisibility(store, {
    ownerUserId: input.ownerUserId,
    anchor: input.anchor,
    scope: input.content.scope,
    selectedUserIds: input.content.selectedUserIds,
  });

  const memory = await store.createAssetMemory({
    assetId: input.anchor.id,
    ownerUserId: input.ownerUserId,
    status: "suggested",
    label: input.content.label,
    value: input.content.value ?? null,
    notes: input.content.notes ?? null,
    scope: visibility.scope,
    householdId: visibility.householdId,
    sourceRecordId: input.sourceRecordId,
    reviewGroupId: input.groupId,
    createdByUserId: input.ownerUserId,
    lastActorUserId: input.ownerUserId,
  });

  await writeAssetChildShares(store, {
    ...visibility,
    ownerUserId: input.ownerUserId,
    recordKind: "asset_memory",
    recordId: memory.id,
  });

  await recordAudit(store, input.anchor, {
    kind: "memory_suggested",
    actorUserId: input.ownerUserId,
    source: input.auditSource,
    detail: { memoryId: memory.id, label: memory.label, scope: memory.scope, grounded: true },
  });

  return memory;
}

/** Dismisses one suggested memory in place, recording who and why. */
export async function dismissMemory(
  store: AssetReviewLifecycleStore,
  memory: AssetMemory,
  input: { actorUserId: string; source?: AssetAuditSource; cascade?: boolean },
): Promise<void> {
  await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: { status: "dismissed", lastActorUserId: input.actorUserId },
  });
  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_dismissed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: memory.id, label: memory.label, cascade: input.cascade ?? false },
    });
  }
}
