import {
  type ContextSnapshot,
  computeSnapshotFingerprint,
  DETERMINISTIC_GENERATOR_VERSION,
  generateDeterministicSnapshot,
  type SnapshotInputPack,
} from "@tendnote/domain";
import { createPersonContext } from "../person-context";
import type { PersonContextSnapshotStore } from "./types";

export type GetPersonContextSnapshotInput = {
  ownerUserId: string;
  personId: string;
};

export type PersonContextSnapshotResult = {
  // The current cached snapshot for this owner/person, or null when the person
  // is unknown to the owner. Fail-open fallback to Phase 1A context arrives in #13.
  snapshot: ContextSnapshot | null;
};

/**
 * Shared snapshot-backed person context read path (PRD #11). Both web and Eve call
 * this seam instead of assembling snapshot context themselves, so generation,
 * policy filtering, and owner scoping stay in one place.
 *
 * Phase 1B slice (#12): loading a person without a current snapshot builds one
 * from the Phase 1A trust-aware person context using the deterministic generator
 * and persists exactly one current row. An existing snapshot is returned as-is;
 * staleness-driven rebuilds and fail-open fallback land in #13.
 */
export function createPersonContextSnapshot(store: PersonContextSnapshotStore) {
  const personContext = createPersonContext(store);

  return {
    async getPersonContextSnapshot(
      input: GetPersonContextSnapshotInput,
    ): Promise<PersonContextSnapshotResult> {
      const existing = await store.getContextSnapshot(input);

      if (existing) {
        return { snapshot: existing };
      }

      // Default snapshots are proactive context, so restricted content stays out
      // (no `directlyRequested`); the Phase 1A filter enforces this (ADR 0058).
      const context = await personContext.getPersonContext(input);

      if (!context.person) {
        return { snapshot: null };
      }

      const pack: SnapshotInputPack = {
        person: context.person,
        approvedMemories: context.approvedMemories,
        sourceRecords: context.sourceRecords,
        suggestedMemories: context.suggestedMemories,
        followups: [],
      };

      const content = generateDeterministicSnapshot(pack);
      const snapshot = await store.upsertContextSnapshot({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        summary: content.summary,
        supportingReferences: content.supportingReferences,
        generatorVersion: DETERMINISTIC_GENERATOR_VERSION,
        inputFingerprint: computeSnapshotFingerprint(pack),
        generatedAt: new Date(),
        failureReason: null,
      });

      return { snapshot };
    },
  };
}
