import type { AssetEvidence, AssetMemory } from "@tendnote/domain";
import type { AddAssetEvidenceInput, RemoveAssetEvidenceInput } from "./evidence-types";
import { acceptSuggestedAsset, dismissSuggestedAsset, editSuggestedAsset } from "./review-assets";
import {
  addAssetEvidence,
  getAssetEvidenceFileForCaller,
  removeAssetEvidence,
} from "./review-evidence";
import { linkAssetReviewGroup } from "./review-link";
import {
  acceptSuggestedAssetMemory,
  dismissSuggestedAssetMemory,
  editSuggestedAssetMemory,
} from "./review-memories";
import {
  buildGroupResult,
  dismissMemory,
  listPendingMemories,
  requireGroup,
} from "./review-shared";
import { createActiveAssetMemory, suggestAsset, suggestAssetMemories } from "./review-suggest";
import type {
  AcceptSuggestedAssetInput,
  AcceptSuggestedAssetMemoryInput,
  AssetMemoryActionInput,
  AssetReviewGroupActionInput,
  AssetReviewGroupResult,
  AssetReviewLifecycleStore,
  CreateActiveAssetMemoryInput,
  EditSuggestedAssetInput,
  EditSuggestedAssetMemoryInput,
  LinkAssetReviewGroupInput,
  ListAssetReviewGroupsInput,
  SuggestAssetInput,
  SuggestAssetMemoriesInput,
  SuggestedAssetActionInput,
} from "./review-types";

/**
 * The owner's still-pending Asset Review Groups, newest first — what the shared
 * Review Queue renders. Owner-scoped: proposals are never another member's to
 * review.
 */
async function listAssetReviewGroups(
  store: AssetReviewLifecycleStore,
  input: ListAssetReviewGroupsInput,
): Promise<AssetReviewGroupResult[]> {
  const groups = await store.listPendingAssetReviewGroupsForOwner(input);
  return Promise.all(groups.map((group) => buildGroupResult(store, group)));
}

/** One group's review result, owner-keyed; null once it no longer exists. */
async function getAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  input: { actorUserId: string; groupId: string },
): Promise<AssetReviewGroupResult | null> {
  const group = await store.getAssetReviewGroup({
    ownerUserId: input.actorUserId,
    groupId: input.groupId,
  });
  return group ? buildGroupResult(store, group) : null;
}

/**
 * Batch-accepts a whole low-risk group: the pending anchor first (details need
 * a durable asset), then every pending memory. Member-level idempotency makes
 * the batch idempotent too — re-running it changes nothing.
 */
async function acceptAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  input: AssetReviewGroupActionInput,
): Promise<AssetReviewGroupResult> {
  const group = await requireGroup(store, {
    ownerUserId: input.actorUserId,
    groupId: input.groupId,
  });

  const anchor = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: group.assetId,
  });
  if (anchor?.status === "suggested") {
    await acceptSuggestedAsset(store, {
      actorUserId: input.actorUserId,
      assetId: anchor.id,
      source: input.source,
    });
  }

  for (const memory of await listPendingMemories(store, group)) {
    await acceptSuggestedAssetMemory(store, {
      actorUserId: input.actorUserId,
      memoryId: memory.id,
      source: input.source,
    });
  }

  return buildGroupResult(store, group);
}

/**
 * Batch-dismisses a whole group: a pending anchor cascades its details; a
 * durable (existing-asset) anchor is left untouched and only the pending
 * details are set aside.
 */
async function dismissAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  input: AssetReviewGroupActionInput,
): Promise<AssetReviewGroupResult> {
  const group = await requireGroup(store, {
    ownerUserId: input.actorUserId,
    groupId: input.groupId,
  });

  const anchor = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: group.assetId,
  });
  if (anchor?.status === "suggested") {
    return dismissSuggestedAsset(store, {
      actorUserId: input.actorUserId,
      assetId: anchor.id,
      source: input.source,
    });
  }

  for (const memory of await listPendingMemories(store, group)) {
    await dismissMemory(store, memory, { actorUserId: input.actorUserId, source: input.source });
  }

  return buildGroupResult(store, group);
}

/**
 * Review-gated Asset Memory and duplicate review (#198; ADRs 0151, 0152). Inferred
 * Assets and Asset Memories are persisted as `suggested` rows — one authoritative
 * record each, owner-only, absent from every durable surface — grouped into an
 * Asset Review Group per source context so the shared Review Queue can show a
 * Suggested Asset, its Suggested Asset Memories, the deterministic duplicate
 * prompt, and the source grounding together. Acceptance flips statuses in place
 * (never copies a row), so promotion is idempotent and the suggested and durable
 * paths never fork — the same model the queue already runs for memories,
 * follow-ups, and General Actions. Later slices (#199 evidence, #200
 * actions/search/Eve) extend this seam additively.
 *
 * A thin factory over module-scope steps (the repo's fallow factory pattern):
 * each step takes the store explicitly, and the review invariants — owner-only,
 * grounded, durable-anchor, fail-closed — live in `review-shared.ts`.
 */
export function createAssetReview(store: AssetReviewLifecycleStore) {
  return {
    suggestAsset: (input: SuggestAssetInput) => suggestAsset(store, input),
    suggestAssetMemories: (input: SuggestAssetMemoriesInput) => suggestAssetMemories(store, input),
    createActiveAssetMemory: (input: CreateActiveAssetMemoryInput) =>
      createActiveAssetMemory(store, input),
    listAssetReviewGroups: (input: ListAssetReviewGroupsInput) =>
      listAssetReviewGroups(store, input),
    getAssetReviewGroup: (input: { actorUserId: string; groupId: string }) =>
      getAssetReviewGroup(store, input),
    /**
     * The active Asset Memories on one asset the caller may see — per-record
     * scope filtering, applied pre-surface, so a household Asset can carry a
     * private detail its members never learn exists (#196).
     */
    listAssetMemories: (input: { callerUserId: string; assetId: string }): Promise<AssetMemory[]> =>
      store.listVisibleAssetMemoriesForAsset(input),
    /**
     * Shared Asset Evidence Capture (#200): one write path for every surface —
     * profile drop zone, mobile capture, review card, and later Eve's plus-menu
     * (#201) — attaching to an active Asset or a still-open review group.
     */
    addAssetEvidence: (input: AddAssetEvidenceInput) => addAssetEvidence(store, input),
    removeAssetEvidence: (input: RemoveAssetEvidenceInput) => removeAssetEvidence(store, input),
    /**
     * The evidence on one asset the caller may see — per-record scope filtering
     * under a durable anchor, applied pre-surface, so a household Asset can hold
     * a private receipt its members never learn exists (#196).
     */
    listAssetEvidence: (input: {
      callerUserId: string;
      assetId: string;
    }): Promise<AssetEvidence[]> => store.listVisibleAssetEvidenceForAsset(input),
    /** Stored upload bytes, gated by the caller's visibility of the record. */
    getAssetEvidenceFile: (input: { callerUserId: string; evidenceId: string }) =>
      getAssetEvidenceFileForCaller(store, input),
    acceptSuggestedAsset: (input: AcceptSuggestedAssetInput) => acceptSuggestedAsset(store, input),
    editSuggestedAsset: (input: EditSuggestedAssetInput) => editSuggestedAsset(store, input),
    dismissSuggestedAsset: (input: SuggestedAssetActionInput) =>
      dismissSuggestedAsset(store, input),
    acceptSuggestedAssetMemory: (input: AcceptSuggestedAssetMemoryInput) =>
      acceptSuggestedAssetMemory(store, input),
    editSuggestedAssetMemory: (input: EditSuggestedAssetMemoryInput) =>
      editSuggestedAssetMemory(store, input),
    dismissSuggestedAssetMemory: (input: AssetMemoryActionInput) =>
      dismissSuggestedAssetMemory(store, input),
    acceptAssetReviewGroup: (input: AssetReviewGroupActionInput) =>
      acceptAssetReviewGroup(store, input),
    dismissAssetReviewGroup: (input: AssetReviewGroupActionInput) =>
      dismissAssetReviewGroup(store, input),
    linkAssetReviewGroup: (input: LinkAssetReviewGroupInput) => linkAssetReviewGroup(store, input),
  };
}
