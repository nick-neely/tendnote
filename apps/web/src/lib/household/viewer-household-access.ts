import "server-only";

import { getAdmittedHouseholdForUser } from "@tendnote/db/queries/households";
import { cache } from "react";
import { NO_VIEWER_STANDINGS, type ViewerStandings } from "@/components/app-destinations";
import { admittedOwnerOrNull } from "@/lib/access/current-access";

/**
 * Whether this request's caller currently has a Household destination.
 *
 * The one question navigation asks, answered from live membership rather than
 * from a session claim, a role, or a cookie. Departure, removal, and dissolution
 * therefore take the destination away on the caller's next request, which is
 * what the shared-home decision requires of it.
 *
 * It never rejects. Navigation is chrome around whatever the member came here to
 * do, and a household lookup that fails must not take the shell down with it — so
 * an unavailable read resolves to "no Household", the same fail-closed answer an
 * ended membership gives.
 *
 * Memoised per request because the shell asks twice: once for the desktop rail
 * and once for the phone Menu.
 */
export const readViewerHouseholdAccess = cache(
  async function readViewerHouseholdAccess(): Promise<ViewerStandings> {
    try {
      const ownerUserId = await admittedOwnerOrNull();
      if (!ownerUserId) return NO_VIEWER_STANDINGS;
      const household = await getAdmittedHouseholdForUser({ userId: ownerUserId });
      return { householdMember: household !== null };
    } catch {
      return NO_VIEWER_STANDINGS;
    }
  },
);
