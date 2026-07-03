import type { Memory, SemanticRetrievalResult } from "@tendnote/domain";
import { createInMemoryFollowupLifecycleStore } from "../followups/in-memory-store";
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
    async listSourceRecordReviewsForOwner(input) {
      return sourceRecordReviews.filter(
        (review) => review.sourceRecord.ownerUserId === input.ownerUserId,
      );
    },
    async listRecentSourceRecordsForOwner(input) {
      return recentSourceRecords
        .filter((review) => review.sourceRecord.ownerUserId === input.ownerUserId)
        .slice(0, input.limit ?? 3);
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
