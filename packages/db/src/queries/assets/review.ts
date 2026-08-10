import type { AssetAuditSource, AssetEvidence, AssetMemory } from "@tendnote/domain";
import {
  type AssetEmbeddingDeps,
  makeScheduleAssetEmbedding,
  type ScheduleAssetEmbedding,
} from "./embed";
import type {
  AddAssetEvidenceInput,
  AddAssetEvidenceToNewAssetInput,
  RemoveAssetEvidenceInput,
} from "./evidence-types";
import {
  editAssetMemory,
  listVisibleAssetEvidence,
  listVisibleAssetMemories,
  restoreAssetMemory,
  setAsideAssetMemory,
} from "./household-children";
import { acceptSuggestedAsset, dismissSuggestedAsset, editSuggestedAsset } from "./review-assets";
import {
  addAssetEvidence,
  addAssetEvidenceToNewAsset,
  getAssetEvidenceFileForCaller,
  listAssetEvidenceCaptureTargets,
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
  EditAssetMemoryInput,
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
 * Finds the still-open review created from one Capture source. The lookup stays
 * owner-scoped and unbounded inside the shared Asset review seam so callers do
 * not approximate identity by loading an arbitrary queue page.
 */
async function findAssetReviewGroupBySource(
  store: AssetReviewLifecycleStore,
  input: { ownerUserId: string; sourceRecordId: string; assetName: string },
): Promise<AssetReviewGroupResult | null> {
  const groups = await store.listPendingAssetReviewGroupsForOwner({
    ownerUserId: input.ownerUserId,
  });
  const normalizedName = input.assetName.trim().toLocaleLowerCase();
  for (const group of groups) {
    if (group.sourceRecordId !== input.sourceRecordId) continue;
    const result = await buildGroupResult(store, group);
    if (result.asset.name.trim().toLocaleLowerCase() === normalizedName) return result;
  }
  return null;
}

/**
 * Batch-accepts a whole low-risk group: the pending anchor first (details need
 * a durable asset), then every pending memory. Member-level idempotency makes
 * the batch idempotent too — re-running it changes nothing.
 *
 * It takes the embedding scheduler because acceptance is the moment these records become
 * *retrievable*, and that is not optional. The embedding processor skips any asset that is not
 * durable and any memory whose anchor is not durable (`decideAssetEmbedding`,
 * `decideAssetMemoryEmbedding`), so everything enqueued while this group was still a proposal was
 * thrown away on purpose. If the accept does not re-enqueue, nothing ever will: the asset and its
 * facts land on the profile and never enter semantic retrieval at all.
 *
 * The scheduler is a parameter rather than a factory wrapper for exactly the reason this bug
 * existed. The single-record accepts embed in `createAssetReview`'s wrappers, and this step calls
 * the *unwrapped* module functions — so the batch path silently opted out of an invariant it had
 * no way to know about. A step that must always be wrapped is a step whose contract is a comment;
 * making the scheduler an argument makes it a signature instead.
 */
async function acceptAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  embed: ScheduleAssetEmbedding,
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
  // Read before the writes: accepted memories drop out of the pending list.
  const pending = await listPendingMemories(store, group);

  if (anchor?.status === "suggested") {
    const accepted = await acceptSuggestedAsset(store, {
      actorUserId: input.actorUserId,
      assetId: anchor.id,
      source: input.source,
    });
    // Durable for the first time, so the anchor itself is retrievable now.
    await embed.asset(accepted.asset);
  }

  for (const memory of pending) {
    await acceptSuggestedAssetMemory(store, {
      actorUserId: input.actorUserId,
      memoryId: memory.id,
      source: input.source,
    });
    await embed.memory(memory);
  }

  return buildGroupResult(store, group);
}

/**
 * Batch-dismisses a whole group: a pending anchor cascades its details; a
 * durable (existing-asset) anchor is left untouched and only the pending
 * details are set aside.
 *
 * Dismissal re-enqueues too, for the mirror-image reason: a suggestion hanging off an asset the
 * user *already* has was embedded when it was proposed (that is how the owner's review surface
 * finds grounded proposals), so setting it aside must let the processor drop the vector — the
 * single-record dismiss already does this. A rejected guess that stays semantically retrievable
 * is a fact the user thought they had deleted.
 */
async function dismissAssetReviewGroup(
  store: AssetReviewLifecycleStore,
  embed: ScheduleAssetEmbedding,
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
  const pending = await listPendingMemories(store, group);

  if (anchor?.status === "suggested") {
    const husk = await dismissSuggestedAsset(store, {
      actorUserId: input.actorUserId,
      assetId: anchor.id,
      source: input.source,
    });
    // The proposal and everything it cascaded: re-enqueued so the processor drops whatever it
    // holds for them. Nothing under a suggested anchor is embedded *today* — which is exactly
    // why this must not rely on that: the moment an accept path changes, "harmless because of
    // another bug" stops being harmless.
    await embed.asset(anchor);
    for (const memory of pending) {
      await embed.memory(memory);
    }

    return husk;
  }

  for (const memory of pending) {
    await dismissMemory(store, memory, { actorUserId: input.actorUserId, source: input.source });
    await embed.memory(memory);
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
export function createAssetReview(store: AssetReviewLifecycleStore, deps: AssetEmbeddingDeps = {}) {
  // A memory becomes (or stops being) semantically retrievable as it moves through
  // review, and its embedded text changes when it is edited — so every write that
  // touches either re-enqueues its embedding (#204). Eligibility is re-checked by the
  // processor, so a dismissed memory is skipped rather than embedded.
  const embed = makeScheduleAssetEmbedding(deps);

  return {
    suggestAsset: (input: SuggestAssetInput) => suggestAsset(store, input),
    async suggestAssetMemories(input: SuggestAssetMemoriesInput) {
      const group = await suggestAssetMemories(store, input);
      for (const memory of group.memories) {
        await embed.memory(memory);
      }

      return group;
    },

    async createActiveAssetMemory(input: CreateActiveAssetMemoryInput) {
      const memory = await createActiveAssetMemory(store, input);
      await embed.memory(memory);

      return memory;
    },
    listAssetReviewGroups: (input: ListAssetReviewGroupsInput) =>
      listAssetReviewGroups(store, input),
    getAssetReviewGroup: (input: { actorUserId: string; groupId: string }) =>
      getAssetReviewGroup(store, input),
    findAssetReviewGroupBySource: (input: {
      ownerUserId: string;
      sourceRecordId: string;
      assetName: string;
    }) => findAssetReviewGroupBySource(store, input),
    /**
     * The active Asset Memories on one asset the caller may see — per-record
     * scope filtering *and* a per-record proof, applied pre-surface, so a
     * household Asset can carry a private detail its members never learn exists
     * (#196) and a member who left mid-session sees nothing (#386).
     */
    listAssetMemories: (input: { callerUserId: string; assetId: string }): Promise<AssetMemory[]> =>
      listVisibleAssetMemories(store, input),

    /**
     * Corrects a durable, active Asset Memory: the owner's own, or the
     * household's own by any active member. Optimistically fenced, so a
     * correction never silently overwrites another member's (#386).
     */
    async editAssetMemory(input: EditAssetMemoryInput) {
      const memory = await editAssetMemory(store, input);
      // Corrected text embeds differently — re-enqueue so the vector follows.
      await embed.memory(memory);

      return memory;
    },

    /**
     * Sets aside a durable, active Asset Memory that is no longer true. Nothing
     * is deleted, so the household keeps its history and its record (ADR 0214).
     */
    async setAsideAssetMemory(input: AssetMemoryActionInput & { source?: AssetAuditSource }) {
      const memory = await setAsideAssetMemory(store, input);
      // Re-enqueued so the processor drops the vector for a fact that is gone.
      await embed.memory(memory);

      return memory;
    },

    /** Brings a set-aside detail back — the inverse of the above (#386). */
    async restoreAssetMemory(input: AssetMemoryActionInput & { source?: AssetAuditSource }) {
      const memory = await restoreAssetMemory(store, input);
      // True again, so retrievable again.
      await embed.memory(memory);

      return memory;
    },
    /**
     * Shared Asset Evidence Capture (#200): one write path for every surface —
     * profile drop zone, mobile capture, review card, and later Eve's plus-menu
     * (#201) — attaching to an active Asset or a still-open review group.
     */
    addAssetEvidence: (input: AddAssetEvidenceInput) => addAssetEvidence(store, input),
    /**
     * The unclear-destination arm of the same capture path (#201): the user
     * named something new, so the capture opens a review-gated Suggested Asset
     * and the evidence rides its review group.
     */
    addAssetEvidenceToNewAsset: (input: AddAssetEvidenceToNewAssetInput) =>
      addAssetEvidenceToNewAsset(store, input),
    /**
     * The destinations a capture surface may offer (#201): the owner's own
     * active assets plus their still-open review groups — the owner/active/open
     * rule in one owner-scoped entry point.
     */
    listAssetEvidenceCaptureTargets: (input: { ownerUserId: string }) =>
      listAssetEvidenceCaptureTargets(store, input),
    removeAssetEvidence: (input: RemoveAssetEvidenceInput) => removeAssetEvidence(store, input),
    /**
     * The evidence on one asset the caller may see — per-record scope filtering
     * under a durable anchor, applied pre-surface, so a household Asset can hold
     * a private receipt its members never learn exists (#196).
     */
    listAssetEvidence: (input: {
      callerUserId: string;
      assetId: string;
    }): Promise<AssetEvidence[]> => listVisibleAssetEvidence(store, input),
    /** Stored upload bytes, gated by the caller's visibility of the record. */
    getAssetEvidenceFile: (input: { callerUserId: string; evidenceId: string }) =>
      getAssetEvidenceFileForCaller(store, input),
    async acceptSuggestedAsset(input: AcceptSuggestedAssetInput) {
      const group = await acceptSuggestedAsset(store, input);
      // The anchor is durable for the first time, so it — and every memory hanging
      // off it, which the processor previously skipped as un-anchored — becomes
      // retrievable now.
      await embed.asset(group.asset);
      for (const memory of group.memories) {
        await embed.memory(memory);
      }

      return group;
    },
    editSuggestedAsset: (input: EditSuggestedAssetInput) => editSuggestedAsset(store, input),
    dismissSuggestedAsset: (input: SuggestedAssetActionInput) =>
      dismissSuggestedAsset(store, input),
    async acceptSuggestedAssetMemory(input: AcceptSuggestedAssetMemoryInput) {
      const group = await acceptSuggestedAssetMemory(store, input);
      // The accepted memory has dropped out of the group's *pending* list, so it is
      // named from the input; the owner comes from the anchor the seam just verified.
      await embed.memory({ id: input.memoryId, ownerUserId: group.asset.ownerUserId });

      return group;
    },
    async editSuggestedAssetMemory(input: EditSuggestedAssetMemoryInput) {
      const group = await editSuggestedAssetMemory(store, input);
      // Edited text embeds differently — re-enqueue so the vector follows the fact.
      await embed.memory({ id: input.memoryId, ownerUserId: group.asset.ownerUserId });

      return group;
    },
    async dismissSuggestedAssetMemory(input: AssetMemoryActionInput) {
      const group = await dismissSuggestedAssetMemory(store, input);
      // Re-enqueued so the processor skips it and the stale vector stops being served.
      await embed.memory({ id: input.memoryId, ownerUserId: group.asset.ownerUserId });

      return group;
    },
    acceptAssetReviewGroup: (input: AssetReviewGroupActionInput) =>
      acceptAssetReviewGroup(store, embed, input),
    dismissAssetReviewGroup: (input: AssetReviewGroupActionInput) =>
      dismissAssetReviewGroup(store, embed, input),
    async linkAssetReviewGroup(input: LinkAssetReviewGroupInput) {
      const group = await linkAssetReviewGroup(store, input);
      // Duplicate review re-anchored these still-pending details onto an asset that is already
      // durable — which is the same state change acceptance makes, and makes them eligible for
      // embedding for the first time. The husk they left behind is not durable, so the processor
      // will drop anything held for it on its own.
      for (const memory of group.memories) {
        await embed.memory(memory);
      }

      return group;
    },
  };
}
