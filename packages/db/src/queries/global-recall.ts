import { searchAssetsWithStatus } from "./asset-search";
import { createDefaultGoogleCalendarReader, readConnectedOwnerCalendar } from "./calendar";
import { searchHouseholdContextFacts, searchSelfContextFacts } from "./context-facts";
import { searchFollowups } from "./followups";
import { searchGiftPlans } from "./gift-plans";
import { createGlobalRecall } from "./global-recall/queries";
import type { GlobalRecallDependencies, SearchGlobalRecallRequest } from "./global-recall/types";
import { searchRelationshipContext } from "./relationship-context-search";
import { searchSavedItems } from "./saved-items";
import { searchSavedItemsSemantic, searchSemanticContext } from "./semantic-retrieval";

export { createGlobalRecall } from "./global-recall/queries";
export { toSelfContextResult } from "./global-recall/result-normalizers";
export type * from "./global-recall/types";

const calendarReader = createDefaultGoogleCalendarReader();

export function createDefaultGlobalRecall(overrides: Partial<GlobalRecallDependencies> = {}) {
  return createGlobalRecall({
    searchSelfContextExact: ({ callerUserId, query, directlyRequested, includeArchived, limit }) =>
      searchSelfContextFacts(
        {
          callerUserId,
          query,
          directlyRequested,
          includeArchived,
          limit,
        },
        async () => callerUserId,
      ),
    searchHouseholdContextExact: ({ callerUserId, query, directlyRequested, limit }) =>
      searchHouseholdContextFacts(
        { callerUserId, query, directlyRequested, limit },
        async () => callerUserId,
      ),
    searchRelationshipExact: (input) =>
      searchRelationshipContext({ ...input, includeReviewGated: false }),
    searchRelationshipRelated: (input) =>
      searchSemanticContext({ ...input, includeReviewGated: false }),
    searchAssets: (input) => searchAssetsWithStatus({ ...input, includeReviewGated: false }),
    // The Gift Plan seam's own proved search, unchanged. Recall narrows nothing
    // further and adds no visibility rule of its own — the seam refuses the
    // Surprise Subject in SQL and again at the proof, and this is one of its thin
    // adapters (docs/phase-8/household-gift-ideas-and-birthday-planning.md).
    searchGiftPlans,
    searchSavedItemsExact: searchSavedItems,
    searchSavedItemsRelated: searchSavedItemsSemantic,
    listFollowups: searchFollowups,
    readCalendar: ({ ownerUserId, query }) => {
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setUTCDate(timeMin.getUTCDate() - 30);
      const timeMax = new Date(now);
      timeMax.setUTCFullYear(timeMax.getUTCFullYear() + 1);
      return readConnectedOwnerCalendar(
        {
          ownerUserId,
          providerKey: "google",
          capabilityKey: "calendar",
          timeMin,
          timeMax,
          maxResults: 50,
          query,
        },
        { reader: calendarReader },
      );
    },
    ...overrides,
  });
}

const defaultGlobalRecall = createDefaultGlobalRecall();

export function searchGlobalRecall(input: SearchGlobalRecallRequest) {
  return defaultGlobalRecall.search(input);
}
