import type { ExactRecallResult, ParsedSearchRelationshipContextInput } from "@tendnote/domain";

export type SearchRelationshipContextQueryInput = ParsedSearchRelationshipContextInput & {
  ownerUserId: string;
};

export type RelationshipContextSearchStore = {
  searchRelationshipContext: (
    input: SearchRelationshipContextQueryInput,
  ) => Promise<ExactRecallResult[]>;
};
