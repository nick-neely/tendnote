import type { ParsedGlobalRecallInput } from "@tendnote/domain";
import { authorizeRestrictedRecall } from "./query-policy";
import type { GlobalRecallDependencies } from "./types";

// Every typed retrieval dependency accepts at most 20 candidates. Keep the fan-out
// bound at the narrowest public contract so one over-limit source cannot fail the
// entire family before retrieval begins.
const CANDIDATE_LIMIT = 20;

export type RecallSearchPlan = {
  exact: boolean;
  related: boolean;
  relationship: boolean;
  assets: boolean;
  savedItems: boolean;
  followups: boolean;
  calendar: boolean;
  selfContext: boolean;
};

export function planRecallSearch(input: ParsedGlobalRecallInput): RecallSearchPlan {
  return {
    exact: !input.matchKinds || input.matchKinds.includes("exact"),
    related: !input.matchKinds || input.matchKinds.includes("related"),
    relationship: ["all", "people", "actions"].includes(input.family),
    assets: input.family === "all" || input.family === "assets",
    savedItems: input.family === "all" || input.family === "saved_items",
    followups: input.family === "all" || input.family === "follow_ups",
    calendar: input.family === "all" || input.family === "calendar",
    selfContext: input.family === "all" || input.family === "self_context",
  };
}

export async function retrieveRecallSources(
  deps: GlobalRecallDependencies,
  ownerUserId: string,
  input: ParsedGlobalRecallInput,
  plan: RecallSearchPlan,
) {
  const restricted = authorizeRestrictedRecall(input);
  return Promise.allSettled([
    plan.relationship && plan.exact
      ? deps.searchRelationshipExact({
          ownerUserId,
          query: input.query,
          directlyRequested: restricted.directlyRequested,
          includeArchived: input.includeArchived,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    plan.relationship && plan.related
      ? deps.searchRelationshipRelated({
          ownerUserId,
          query: input.query,
          directlyRequested: restricted.directlyRequested,
          includeArchived: input.includeArchived,
          minimumSimilarity: 0,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    plan.assets
      ? deps.searchAssets({
          ownerUserId,
          query: input.query,
          includeArchived: input.includeArchived,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve({ results: [], semanticAvailable: true }),
    plan.savedItems && plan.exact
      ? deps.searchSavedItemsExact({
          callerUserId: ownerUserId,
          query: input.query,
          includeArchived: input.includeArchived,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    plan.savedItems && plan.related
      ? deps.searchSavedItemsRelated({
          ownerUserId,
          query: input.query,
          includeArchived: input.includeArchived,
          minimumSimilarity: 0,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    plan.followups
      ? deps.listFollowups({
          ownerUserId,
          includeArchived: input.includeArchived,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
    plan.calendar
      ? deps.readCalendar({ ownerUserId, query: input.query })
      : Promise.resolve({ connected: false, result: null }),
    plan.selfContext && plan.exact
      ? deps.searchSelfContextExact({
          callerUserId: ownerUserId,
          query: input.query,
          directlyRequested: restricted.directlyRequested,
          includeArchived: input.includeArchived,
          limit: CANDIDATE_LIMIT,
        })
      : Promise.resolve([]),
  ] as const);
}

export type RecallRetrievalOutcomes = Awaited<ReturnType<typeof retrieveRecallSources>>;

export function normalizeRecallSources(outcomes: RecallRetrievalOutcomes, plan: RecallSearchPlan) {
  const [
    exact,
    related,
    assets,
    savedItemsExact,
    savedItemsRelated,
    followups,
    calendar,
    selfContext,
  ] = outcomes;
  return {
    exact: exact.status === "fulfilled" ? exact.value : [],
    related:
      (!plan.exact || exact.status === "fulfilled") && related.status === "fulfilled"
        ? related.value
        : [],
    assets:
      assets.status === "fulfilled" ? assets.value : { results: [], semanticAvailable: false },
    savedItemsExact: savedItemsExact.status === "fulfilled" ? savedItemsExact.value : [],
    savedItemsRelated:
      (!plan.exact || savedItemsExact.status === "fulfilled") &&
      savedItemsRelated.status === "fulfilled"
        ? savedItemsRelated.value
        : [],
    followups: followups.status === "fulfilled" ? followups.value : [],
    calendar: calendar.status === "fulfilled" ? calendar.value : { connected: false, result: null },
    selfContext: selfContext.status === "fulfilled" ? selfContext.value : [],
  };
}

export type RecallSourceResults = ReturnType<typeof normalizeRecallSources>;
