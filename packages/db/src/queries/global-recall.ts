import { searchAssetsWithStatus } from "./asset-search";
import { createDefaultGoogleCalendarReader, readConnectedOwnerCalendar } from "./calendar";
import { searchFollowups } from "./followups";
import { createGlobalRecall } from "./global-recall/queries";
import type { GlobalRecallDependencies, SearchGlobalRecallRequest } from "./global-recall/types";
import { searchRelationshipContext } from "./relationship-context-search";
import { searchSavedItems } from "./saved-items";
import { searchSavedItemsSemantic, searchSemanticContext } from "./semantic-retrieval";

export { createGlobalRecall } from "./global-recall/queries";
export type * from "./global-recall/types";

const calendarReader = createDefaultGoogleCalendarReader();

export function createDefaultGlobalRecall(overrides: Partial<GlobalRecallDependencies> = {}) {
  return createGlobalRecall({
    searchRelationshipExact: (input) =>
      searchRelationshipContext({ ...input, includeReviewGated: false }),
    searchRelationshipRelated: (input) =>
      searchSemanticContext({ ...input, includeReviewGated: false }),
    searchAssets: (input) => searchAssetsWithStatus({ ...input, includeReviewGated: false }),
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
