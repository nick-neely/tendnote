import type { Memory, SemanticRetrievalResult } from "@tendnote/domain";
import { createInMemoryFollowupLifecycleStore } from "../followups/in-memory-store";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import type { RelationshipAgendaSourceRecordReview, RelationshipAgendaStore } from "./types";

export type InMemoryRelationshipAgendaStore = RelationshipAgendaStore &
  ReturnType<typeof createInMemoryFollowupLifecycleStore> & {
    seedSuggestedMemories: (memories: Memory[]) => void;
    seedSourceRecordReviews: (reviews: RelationshipAgendaSourceRecordReview[]) => void;
    seedRecentSourceRecords: (reviews: RelationshipAgendaSourceRecordReview[]) => void;
    seedSemanticResults: (
      ownerUserId: string,
      results: Array<
        Omit<SemanticRetrievalResult, "visibilityChoice" | "visibilityLabel"> & {
          visibilityChoice?: SemanticRetrievalResult["visibilityChoice"];
          visibilityLabel?: string;
        }
      >,
    ) => void;
    failSemanticSearch: (error?: Error) => void;
    listSemanticSearchInputs: () => Array<{
      ownerUserId: string;
      query: string;
      limit?: number;
      directlyRequested?: boolean;
    }>;
  };

export function createInMemoryRelationshipAgendaStore(): InMemoryRelationshipAgendaStore {
  const base = createInMemoryFollowupLifecycleStore();
  let suggestedMemories: Memory[] = [];
  let sourceRecordReviews: RelationshipAgendaSourceRecordReview[] = [];
  let recentSourceRecords: RelationshipAgendaSourceRecordReview[] = [];
  let semanticResults: Array<{ ownerUserId: string; result: SemanticRetrievalResult }> = [];
  let semanticSearchError: Error | null = null;
  const semanticSearchInputs: Array<{
    ownerUserId: string;
    query: string;
    limit?: number;
    directlyRequested?: boolean;
  }> = [];

  return {
    ...base,
    seedSuggestedMemories(memories) {
      suggestedMemories = memories;
    },
    seedSourceRecordReviews(reviews) {
      sourceRecordReviews = reviews;
    },
    seedRecentSourceRecords(reviews) {
      recentSourceRecords = reviews;
    },
    seedSemanticResults(ownerUserId, results) {
      semanticResults = results.map((result) => ({
        ownerUserId,
        result: { visibilityChoice: "only_me", visibilityLabel: "Only me", ...result },
      }));
      semanticSearchError = null;
    },
    failSemanticSearch(error = new Error("semantic search unavailable")) {
      semanticSearchError = error;
    },
    listSemanticSearchInputs() {
      return semanticSearchInputs;
    },
    async listSuggestedMemoriesForOwner(input) {
      return suggestedMemories.filter((memory) => memory.ownerUserId === input.ownerUserId);
    },
    async listVisibleSuggestedMemories(input) {
      const memberships = await base.listActiveHouseholdMembershipsForUser({
        userId: input.callerUserId,
      });
      const visible = [];

      for (const memory of suggestedMemories.filter(
        (candidate) => candidate.status === "suggested",
      )) {
        const shares = memory.householdId
          ? await base.listHouseholdRecordShares({
              householdId: memory.householdId,
              recordKind: "memory",
              recordId: memory.id,
            })
          : [];

        if (
          canViewerSeeSeededHouseholdRecord({
            callerUserId: input.callerUserId,
            record: memory,
            recordKind: "memory",
            householdMemberships: memberships,
            householdRecordShares: shares,
          })
        ) {
          visible.push(memory);
        }
      }

      return visible.slice(0, input.limit ?? 20);
    },
    async listVisibleSuggestedFollowups(input) {
      return base.listVisibleSuggestedFollowups(input);
    },
    async listSourceRecordReviewsForOwner(input) {
      return sourceRecordReviews.filter(
        (review) => review.sourceRecord.ownerUserId === input.ownerUserId,
      );
    },
    async listVisibleSourceRecordReviews(input) {
      const memberships = await base.listActiveHouseholdMembershipsForUser({
        userId: input.callerUserId,
      });
      const visible = [];

      for (const review of sourceRecordReviews.filter((candidate) =>
        ["active", "pending_resolution"].includes(candidate.sourceRecord.status),
      )) {
        const shares = review.sourceRecord.householdId
          ? await base.listHouseholdRecordShares({
              householdId: review.sourceRecord.householdId,
              recordKind: "source_record",
              recordId: review.sourceRecord.id,
            })
          : [];

        if (
          canViewerSeeSeededHouseholdRecord({
            callerUserId: input.callerUserId,
            record: review.sourceRecord,
            recordKind: "source_record",
            householdMemberships: memberships,
            householdRecordShares: shares,
          })
        ) {
          visible.push(review);
        }
      }

      return visible.slice(0, input.limit ?? 20);
    },
    async listRecentSourceRecordsForOwner(input) {
      return recentSourceRecords
        .filter((review) => review.sourceRecord.ownerUserId === input.ownerUserId)
        .slice(0, input.limit ?? 3);
    },
    async listVisibleRecentSourceRecords(input) {
      const memberships = await base.listActiveHouseholdMembershipsForUser({
        userId: input.callerUserId,
      });
      const visible = [];

      for (const review of recentSourceRecords) {
        const shares = review.sourceRecord.householdId
          ? await base.listHouseholdRecordShares({
              householdId: review.sourceRecord.householdId,
              recordKind: "source_record",
              recordId: review.sourceRecord.id,
            })
          : [];

        if (
          canViewerSeeSeededHouseholdRecord({
            callerUserId: input.callerUserId,
            record: review.sourceRecord,
            recordKind: "source_record",
            householdMemberships: memberships,
            householdRecordShares: shares,
          })
        ) {
          visible.push(review);
        }
      }

      return visible.slice(0, input.limit ?? 3);
    },
    async searchSemanticContext(input) {
      semanticSearchInputs.push(input);

      if (semanticSearchError) {
        throw semanticSearchError;
      }

      return semanticResults
        .filter((entry) => entry.ownerUserId === input.ownerUserId)
        .map((entry) => entry.result)
        .filter((result) => result.sensitivity !== "restricted" || input.directlyRequested === true)
        .slice(0, input.limit ?? 3);
    },
  };
}
