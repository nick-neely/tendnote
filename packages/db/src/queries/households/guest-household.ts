import type { GuestHouseholdReader } from "../access-profiles/admission";
import type { HouseholdStore } from "./types";

/**
 * The household an account belongs to, with its active Owners, for the
 * Household Guest liveness check. Reads membership only: whether any of those
 * Owners is admitted is the admission resolver's question, not this one's.
 */
export function createGuestHouseholdReader(
  store: Pick<HouseholdStore, "listActiveHouseholdMembershipsForUser" | "listHouseholdMemberships">,
): GuestHouseholdReader {
  return async ({ userId }) => {
    const [membership] = await store.listActiveHouseholdMembershipsForUser({ userId });
    if (!membership) return null;

    const members = await store.listHouseholdMemberships({
      householdId: membership.householdId,
      status: "active",
    });
    return {
      householdId: membership.householdId,
      ownerUserIds: members.filter((member) => member.role === "owner").map((m) => m.userId),
    };
  };
}
