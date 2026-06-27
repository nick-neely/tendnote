import type { Memory } from "@tendnote/domain";
import { createInMemoryFollowupLifecycleStore } from "../followups/in-memory-store";
import type { RelationshipAgendaSourceRecordReview, RelationshipAgendaStore } from "./types";

export type InMemoryRelationshipAgendaStore = RelationshipAgendaStore &
  ReturnType<typeof createInMemoryFollowupLifecycleStore> & {
    seedSuggestedMemories: (memories: Memory[]) => void;
    seedSourceRecordReviews: (reviews: RelationshipAgendaSourceRecordReview[]) => void;
  };

export function createInMemoryRelationshipAgendaStore(): InMemoryRelationshipAgendaStore {
  const base = createInMemoryFollowupLifecycleStore();
  let suggestedMemories: Memory[] = [];
  let sourceRecordReviews: RelationshipAgendaSourceRecordReview[] = [];

  return {
    ...base,
    seedSuggestedMemories(memories) {
      suggestedMemories = memories;
    },
    seedSourceRecordReviews(reviews) {
      sourceRecordReviews = reviews;
    },
    async listSuggestedMemoriesForOwner(input) {
      return suggestedMemories.filter((memory) => memory.ownerUserId === input.ownerUserId);
    },
    async listSourceRecordReviewsForOwner(input) {
      return sourceRecordReviews.filter(
        (review) => review.sourceRecord.ownerUserId === input.ownerUserId,
      );
    },
  };
}
