import {
  type Asset,
  type AssetAuditSource,
  type AssetMemory,
  AssetValidationError,
  assetMemoryEditSchema,
  isEmptyAssetMemoryEdit,
  resolveAssetMemoryContentPatch,
} from "@tendnote/domain";
import { recordAudit } from "./lifecycle";
import {
  ACCEPT_ANCHOR_FIRST,
  buildGroupResult,
  dismissMemory,
  loadAnchor,
  requireGroup,
  requireSuggestedMemory,
  SET_ASIDE,
} from "./review-shared";
import type {
  AcceptSuggestedAssetMemoryInput,
  AssetMemoryActionInput,
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  EditSuggestedAssetMemoryInput,
} from "./review-types";

/**
 * Reviewing one Suggested Asset Memory (#198): accept promotes it in place —
 * but only under a durable, active anchor, so a detail never becomes truth for
 * an asset that is itself still a proposal — edit corrects it while it stays
 * suggested, dismiss sets it aside without touching its siblings.
 */

/** The durable-anchor gate: a detail never becomes truth under a proposal. */
async function requirePromotableAnchor(
  store: AssetReviewLifecycleStore,
  memory: AssetMemory,
): Promise<Asset> {
  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (!anchor) {
    throw new Error("Asset not found.");
  }
  if (anchor.status === "suggested") {
    throw new AssetValidationError(ACCEPT_ANCHOR_FIRST);
  }
  if (anchor.status !== "active") {
    throw new AssetValidationError(
      "This detail's asset isn't active. Restore or re-propose it first.",
    );
  }
  return anchor;
}

/** Promotes one suggested memory in place, applying an optional edit first. */
async function promoteMemory(
  store: AssetReviewLifecycleStore,
  input: AcceptSuggestedAssetMemoryInput,
  memory: AssetMemory,
): Promise<void> {
  const anchor = await requirePromotableAnchor(store, memory);
  const edit = assetMemoryEditSchema.parse(input.edit ?? {});
  const contentPatch = isEmptyAssetMemoryEdit(edit)
    ? {}
    : resolveAssetMemoryContentPatch(memory, edit);

  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: { ...contentPatch, status: "active", lastActorUserId: input.actorUserId },
  });

  await recordAudit(store, anchor, {
    kind: "memory_promoted",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: {
      memoryId: updated.id,
      label: updated.label,
      edited: !isEmptyAssetMemoryEdit(edit),
      fromSuggestion: true,
      sourceRecordId: updated.sourceRecordId,
    },
  });
}

/**
 * Applies an edit that arrived with a re-accept of an already-active detail.
 * Re-accepting never re-promotes, but a correction the reviewer typed must
 * still land — it is never silently discarded. A bare retry stays a pure no-op.
 */
async function applyPostAcceptEdit(
  store: AssetReviewLifecycleStore,
  input: AcceptSuggestedAssetMemoryInput,
  memory: AssetMemory,
): Promise<void> {
  const edit = assetMemoryEditSchema.parse(input.edit ?? {});
  if (isEmptyAssetMemoryEdit(edit)) {
    return;
  }
  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: {
      ...resolveAssetMemoryContentPatch(memory, edit),
      lastActorUserId: input.actorUserId,
    },
  });
  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_edited",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: updated.id, label: updated.label, postAccept: true },
    });
  }
}

/**
 * Accepts one Suggested Asset Memory, promoting it in place to a durable active
 * memory under a durable, active anchor. An optional edit corrects the content
 * first. Idempotent on re-accept — and a correction riding a re-accept still
 * lands as a post-accept edit rather than being silently dropped.
 */
export async function acceptSuggestedAssetMemory(
  store: AssetReviewLifecycleStore,
  input: AcceptSuggestedAssetMemoryInput,
): Promise<AssetReviewGroupResult> {
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
  if (!memory.reviewGroupId) {
    throw new AssetValidationError("Only a suggested detail can be accepted.");
  }
  const group = await requireGroup(store, {
    ownerUserId: input.actorUserId,
    groupId: memory.reviewGroupId,
  });

  if (memory.status === "suggested") {
    await promoteMemory(store, input, memory);
  } else {
    await applyPostAcceptEdit(store, input, memory);
  }

  return buildGroupResult(store, group);
}

/** Corrects a Suggested Asset Memory's content in place without accepting it. */
export async function editSuggestedAssetMemory(
  store: AssetReviewLifecycleStore,
  input: EditSuggestedAssetMemoryInput,
): Promise<AssetReviewGroupResult> {
  const memory = await requireSuggestedMemory(store, input);
  const contentPatch = resolveAssetMemoryContentPatch(
    memory,
    assetMemoryEditSchema.parse(input.edit),
  );

  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: { ...contentPatch, lastActorUserId: input.actorUserId },
  });

  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_edited",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: updated.id, label: updated.label, reviewEdit: true },
    });
  }

  if (!memory.reviewGroupId) {
    throw new Error("Asset review group not found.");
  }
  return buildGroupResult(
    store,
    await requireGroup(store, { ownerUserId: input.actorUserId, groupId: memory.reviewGroupId }),
  );
}

/** Dismisses one Suggested Asset Memory without touching its siblings. */
export async function dismissSuggestedAssetMemory(
  store: AssetReviewLifecycleStore,
  input: AssetMemoryActionInput & { source?: AssetAuditSource },
): Promise<AssetReviewGroupResult> {
  const memory = await requireSuggestedMemory(store, input);
  await dismissMemory(store, memory, { actorUserId: input.actorUserId, source: input.source });
  if (!memory.reviewGroupId) {
    throw new Error("Asset review group not found.");
  }
  return buildGroupResult(
    store,
    await requireGroup(store, { ownerUserId: input.actorUserId, groupId: memory.reviewGroupId }),
  );
}
