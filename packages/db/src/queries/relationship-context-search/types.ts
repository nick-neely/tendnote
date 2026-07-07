import type {
  ExactRecallResult,
  ParsedSearchRelationshipContextInput,
  SearchRelationshipContextInput,
} from "@tendnote/domain";

export type SearchRelationshipContextQueryInput = ParsedSearchRelationshipContextInput & {
  ownerUserId: string;
};

/**
 * The unparsed request shape for the exact-recall entry points (the queries layer and
 * the public wrapper): the raw {@link SearchRelationshipContextInput} plus the owner id,
 * with the schema filling defaults (limit, directlyRequested, includeReviewGated). The
 * store keeps the parsed {@link SearchRelationshipContextQueryInput}.
 */
export type SearchRelationshipContextRequest = SearchRelationshipContextInput & {
  ownerUserId: string;
};

export type RelationshipContextSearchStore = {
  searchRelationshipContext: (
    input: SearchRelationshipContextQueryInput,
  ) => Promise<ExactRecallResult[]>;
};
