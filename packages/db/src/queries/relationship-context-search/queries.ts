import { searchRelationshipContextSchema } from "@tendnote/domain";
import type { RelationshipContextSearchStore, SearchRelationshipContextQueryInput } from "./types";

export function createRelationshipContextSearchQueries(store: RelationshipContextSearchStore) {
  return {
    async searchRelationshipContext(input: SearchRelationshipContextQueryInput) {
      const parsed = searchRelationshipContextSchema.parse(input);

      return store.searchRelationshipContext({
        ownerUserId: input.ownerUserId,
        ...parsed,
      });
    },
  };
}
