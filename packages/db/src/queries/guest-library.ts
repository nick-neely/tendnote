import type { GuestLibraryCandidate } from "@tendnote/domain/guest-library";
import { listAssets } from "./assets";
import { listHouseholdContextFacts } from "./context-facts";
import { listActiveGeneralActions } from "./general-actions";
import { listGiftPlans } from "./gift-plans";
import { getHouseholdOverviewForUser } from "./households";
import { createGuestLibraryReader } from "./households/guest-library";
import { listSharedRelationshipRecords } from "./relationship-shares";

/**
 * The Household Guest's library over the live domain reads (#636).
 *
 * Household Calendar Events arrive from the caller because reading them rides a
 * provider credential the web app owns; everything else is read here.
 */
export function getGuestLibrary(input: {
  guestUserId: string;
  listCalendarEvents: (input: { callerUserId: string }) => Promise<GuestLibraryCandidate[]>;
}) {
  return createGuestLibraryReader({
    readHousehold: getHouseholdOverviewForUser,
    listSharedRelationshipRecords,
    listActiveGeneralActions,
    listAssets,
    listGiftPlans,
    // The guest is the verified caller: the session resolved it, and nothing
    // here lets a request name someone else.
    listHouseholdContextFacts: ({ callerUserId }) =>
      listHouseholdContextFacts({ callerUserId }, async () => callerUserId),
    listCalendarEvents: input.listCalendarEvents,
  })({ guestUserId: input.guestUserId });
}
