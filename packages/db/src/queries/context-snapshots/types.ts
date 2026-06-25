import type { ContextSnapshot, CreateContextSnapshotInput } from "@tendnote/domain";
import type { FollowupContextStore } from "../followups/types";
import type { PersonContextStore } from "../person-context";

/**
 * Owner-scoped persistence surface for the context-snapshot cache. `getContextSnapshot`
 * returns the single current row for an owner/person (or null); `upsertContextSnapshot`
 * writes that one current row, replacing any existing one (ADR 0009, one current
 * row per owner/person).
 */
export type ContextSnapshotStore = {
  getContextSnapshot: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<ContextSnapshot | null>;
  upsertContextSnapshot: (input: CreateContextSnapshotInput) => Promise<ContextSnapshot>;
};

/**
 * Combined store the snapshot read path depends on: the Phase 1A trust-aware
 * person context inputs, the person's follow-ups, and the snapshot cache. Web and
 * Eve both consume the builder created over this store so generation, policy, and
 * owner scoping stay shared (PRD #11).
 */
export type PersonContextSnapshotStore = PersonContextStore &
  FollowupContextStore &
  ContextSnapshotStore;

export type InMemoryContextSnapshotStore = ContextSnapshotStore & {
  listContextSnapshots: (input: { ownerUserId: string }) => Promise<ContextSnapshot[]>;
};
