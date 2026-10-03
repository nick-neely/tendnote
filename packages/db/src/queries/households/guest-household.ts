import type { GuestHouseholdReader, GuestStandingReader } from "../access-profiles/admission";
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

/**
 * The membership facts behind a {@link GuestStandingReader} (#637). A
 * membership held now outranks one that ended, and an Owner's membership never
 * reads as a guest's.
 */
export function createGuestStandingReader(
  store: Pick<HouseholdStore, "listHouseholdMembershipsForUser">,
): GuestStandingReader {
  return async ({ userId }) => {
    const memberships = (await store.listHouseholdMembershipsForUser({ userId })).filter(
      (membership) => membership.role !== "owner",
    );
    if (memberships.some((membership) => membership.status === "active")) {
      return "household_inactive";
    }
    if (memberships.some((membership) => membership.status === "removed")) {
      return "membership_ended";
    }
    return null;
  };
}
