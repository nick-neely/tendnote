import { searchRelationshipContextSchema } from "@tendnote/domain";
import type { RelationshipContextSearchStore, SearchRelationshipContextRequest } from "./types";

export function createRelationshipContextSearchQueries(store: RelationshipContextSearchStore) {
  return {
    async searchRelationshipContext(input: SearchRelationshipContextRequest) {
      const parsed = searchRelationshipContextSchema.parse(input);

      return store.searchRelationshipContext({
        ownerUserId: input.ownerUserId,
        ...parsed,
      });
    },
  };
}
