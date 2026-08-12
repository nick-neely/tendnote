import { randomUUID } from "node:crypto";
import {
  type AssetMemory,
  type AssetReviewGroup,
  assetMemorySchema,
  assetReviewGroupSchema,
  canViewScopedRecord,
  createAssetMemorySchema,
  createAssetReviewGroupSchema,
  createGeneralActionAssetLinkSchema,
  type GeneralActionAssetLink,
  scopedRecordVisibility,
} from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { HouseholdStore } from "../households/types";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { InMemorySourceRecordStore } from "../source-records/types";
import type { AssetEvidenceStore } from "./evidence-types";
import { createInMemoryAssetEvidenceStore } from "./in-memory-evidence-store";
import { createInMemoryAssetLinkStore } from "./in-memory-link-store";
import { createInMemoryAssetStore } from "./in-memory-store";
import type { AssetLinkStore } from "./link-types";
import type { AssetReviewStore, GeneralActionAssetLinkStore } from "./review-types";
import type { AssetStore } from "./types";

/**
 * Minimal Asset Memory + Asset Review Group store over maps (#198), mirroring the
 * drizzle review store's behavior so the review lifecycle tests are authoritative
 * for both. Composes over the asset store's owner-keyed read (to know whether a
 * group's anchor is still a pending proposal) and the shared household store (for
 * per-record memory visibility).
 */
export function createInMemoryAssetReviewStore(deps: {
  getOwnedAsset: AssetStore["getAsset"];
  householdStore: HouseholdStore;
}): AssetReviewStore {
  const memories = new Map<string, AssetMemory>();
  const groups = new Map<string, AssetReviewGroup>();

  /** Oldest first, id tiebreak — a stable ledger of facts, both stores alike. */
  function byCreatedThenId(a: AssetMemory, b: AssetMemory): number {
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  }

  /** Whether the caller may see a memory: private = owner; household = members. */
  async function canCallerViewMemory(input: { callerUserId: string; memory: AssetMemory }) {
    const activeMemberships = input.memory.householdId
      ? await deps.householdStore.listHouseholdMemberships({
          householdId: input.memory.householdId,
          status: "active",
        })
      : [];
    const shares = input.memory.householdId
      ? await deps.householdStore.listHouseholdRecordShares({
          householdId: input.memory.householdId,
          recordKind: "asset_memory",
          recordId: input.memory.id,
        })
      : [];
    return canViewScopedRecord({
      callerUserId: input.callerUserId,
      record: scopedRecordVisibility({
        ownerUserId: input.memory.ownerUserId,
        scope: input.memory.scope,
        householdId: input.memory.householdId,
        shares,
      }),
      activeMemberships,
    });
  }

  async function isGroupPending(group: AssetReviewGroup): Promise<boolean> {
    // A pending anchor is always the owner's own suggested row; a cross-owner
    // (linked/existing) anchor is durable by definition, so the owner-keyed read
    // returning null means "not a pending anchor".
    const anchor = await deps.getOwnedAsset({
      ownerUserId: group.ownerUserId,
      assetId: group.assetId,
    });
    if (anchor?.status === "suggested") {
      return true;
    }
    for (const memory of memories.values()) {
      if (
        memory.reviewGroupId === group.id &&
        memory.ownerUserId === group.ownerUserId &&
        memory.status === "suggested"
      ) {
        return true;
      }
    }
    return false;
  }

  return {
    async createAssetMemory(values) {
      const parsed = createAssetMemorySchema.parse(values);
      const now = new Date();
      const memory: AssetMemory = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
      memories.set(memory.id, memory);
      return memory;
    },
    async getAssetMemory(input) {
      const memory = memories.get(input.memoryId);
      if (!memory || memory.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return memory;
    },
    async getVisibleAssetMemory(input) {
      const memory = memories.get(input.memoryId);
      const admitted: AssetMemory["status"][] = input.includeSetAside
        ? ["active", "dismissed"]
        : ["active"];
      if (
        !memory ||
        // Never `suggested`: review state is not a scope-visible read.
        !admitted.includes(memory.status) ||
        !(await canCallerViewMemory({ callerUserId: input.callerUserId, memory }))
      ) {
        return null;
      }
      return memory;
    },
    async updateAssetMemory(input) {
      const memory = memories.get(input.memoryId);
      if (!memory || memory.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset memory not found.");
      }
      // Re-validate the merged record so field constraints hold for direct store
      // callers too, matching the drizzle store.
      const updated = assetMemorySchema.parse({
        ...memory,
        ...input.patch,
        // The optimistic-concurrency fence is the store's on every write (#386).
        revision: memory.revision + 1,
        updatedAt: new Date(),
      });
      memories.set(updated.id, updated);
      return updated;
    },
    async listAssetMemoriesForOwner(input) {
      return [...memories.values()]
        .filter(
          (memory) =>
            memory.ownerUserId === input.ownerUserId &&
            (input.assetId === undefined || memory.assetId === input.assetId) &&
            (input.reviewGroupId === undefined || memory.reviewGroupId === input.reviewGroupId) &&
            (input.statuses === undefined || input.statuses.includes(memory.status)),
        )
        .sort(byCreatedThenId);
    },
    async listVisibleAssetMemoriesForAsset(input) {
      const visible: AssetMemory[] = [];
      for (const memory of memories.values()) {
        if (
          memory.assetId === input.assetId &&
          // Only durable, active memories are ever scope-visible — suggested and
          // dismissed ones stay in their owner's review (#198).
          memory.status === "active" &&
          (await canCallerViewMemory({ callerUserId: input.callerUserId, memory }))
        ) {
          visible.push(memory);
        }
      }
      return visible.sort(byCreatedThenId);
    },
    async createAssetReviewGroup(values) {
      const parsed = createAssetReviewGroupSchema.parse(values);
      const group: AssetReviewGroup = { ...parsed, id: randomUUID(), createdAt: new Date() };
      groups.set(group.id, group);
      return group;
    },
    async getAssetReviewGroup(input) {
      const group = groups.get(input.groupId);
      if (!group || group.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return group;
    },
    async getAssetReviewGroupByAsset(input) {
      for (const group of groups.values()) {
        if (group.ownerUserId === input.ownerUserId && group.assetId === input.assetId) {
          return group;
        }
      }
      return null;
    },
    async updateAssetReviewGroupAsset(input) {
      const group = groups.get(input.groupId);
      if (!group || group.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset review group not found.");
      }
      const updated = assetReviewGroupSchema.parse({ ...group, assetId: input.assetId });
      groups.set(updated.id, updated);
      return updated;
    },
    async listPendingAssetReviewGroupsForOwner(input) {
      // Newest first: the queue leads with the latest capture context. Ties (same
      // millisecond) fall back to insertion order, newest first — mirroring the
      // microsecond-precision `created_at desc` the drizzle store gets for free.
      const owned = [...groups.values()]
        .filter((group) => group.ownerUserId === input.ownerUserId)
        .reverse()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const pending: AssetReviewGroup[] = [];
      for (const group of owned) {
        if (input.limit !== undefined && pending.length >= input.limit) {
          break;
        }
        if (await isGroupPending(group)) {
          pending.push(group);
        }
      }
      return pending;
    },
  };
}

/**
 * Minimal General Action ↔ Asset link store over a map (#199), mirroring the
 * drizzle link store's behavior: idempotent creation per (action, asset) pair,
 * oldest-first reads, and collision-deleting re-points for duplicate review.
 */
export function createInMemoryGeneralActionAssetLinkStore(): GeneralActionAssetLinkStore {
  const links = new Map<string, GeneralActionAssetLink>();

  /** Oldest first, id tiebreak — the shared ordering contract with drizzle. */
  function byCreatedThenId(a: GeneralActionAssetLink, b: GeneralActionAssetLink): number {
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  }

  function findPair(generalActionId: string, assetId: string): GeneralActionAssetLink | undefined {
    for (const link of links.values()) {
      if (link.generalActionId === generalActionId && link.assetId === assetId) {
        return link;
      }
    }
    return undefined;
  }

  return {
    async createGeneralActionAssetLink(values) {
      const parsed = createGeneralActionAssetLinkSchema.parse(values);
      const existing = findPair(parsed.generalActionId, parsed.assetId);
      if (existing) {
        return existing;
      }
      const link: GeneralActionAssetLink = { ...parsed, id: randomUUID(), createdAt: new Date() };
      links.set(link.id, link);
      return link;
    },
    async listGeneralActionAssetLinksForActions(input) {
      const wanted = new Set(input.generalActionIds);
      return [...links.values()]
        .filter((link) => wanted.has(link.generalActionId))
        .sort(byCreatedThenId);
    },
    async listGeneralActionAssetLinksForAsset(input) {
      return [...links.values()]
        .filter((link) => link.assetId === input.assetId)
        .sort(byCreatedThenId);
    },
    async listAuthorizedGeneralActionAssetLinkActionIds() {
      // The generic Asset Review store has no Action policy. Fail closed; the
      // composed Action–Asset bridge overrides this with its shared Action store.
      return [];
    },
    async repointGeneralActionAssetLinks(input) {
      const authorizedActions = new Set(input.generalActionIds);
      let repointed = 0;
      for (const link of [...links.values()]) {
        if (link.assetId !== input.fromAssetId || !authorizedActions.has(link.generalActionId)) {
          continue;
        }
        // The action already links to the target — the stale row just goes.
        if (findPair(link.generalActionId, input.toAssetId)) {
          links.delete(link.id);
          continue;
        }
        links.set(link.id, { ...link, assetId: input.toAssetId });
        repointed += 1;
      }
      return repointed;
    },
    async deleteGeneralActionAssetLink(input) {
      const link = links.get(input.linkId);
      if (link?.generalActionId === input.generalActionId && link.assetId === input.assetId) {
        links.delete(input.linkId);
      }
    },
  };
}

/**
 * The full in-memory review lifecycle store: one shared household store under the
 * asset store (scope/shares) and the review store (memory visibility), plus a
 * source-record base for grounding and the action-link rows (#199) — the
 * composition `createAssetReview` and the review tests run against.
 */
export function createInMemoryAssetReviewLifecycleStore(): AssetStore &
  AssetReviewStore &
  AssetEvidenceStore &
  GeneralActionAssetLinkStore &
  AssetLinkStore &
  HouseholdStore &
  InMemorySourceRecordStore {
  const householdStore = createInMemoryHouseholdStore();
  const assetStore = createInMemoryAssetStore(householdStore);
  const reviewStore = createInMemoryAssetReviewStore({
    getOwnedAsset: (input) => assetStore.getAsset(input),
    householdStore,
  });
  const evidenceStore = createInMemoryAssetEvidenceStore({
    getOwnedAsset: (input) => assetStore.getAsset(input),
    getVisibleAsset: (input) => assetStore.getVisibleAsset(input),
    householdStore,
  });
  return {
    ...createInMemorySourceRecordStore(),
    ...assetStore,
    ...reviewStore,
    ...evidenceStore,
    ...createInMemoryGeneralActionAssetLinkStore(),
    ...createInMemoryAssetLinkStore(),
  };
}
