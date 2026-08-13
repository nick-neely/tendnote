import type { HouseholdRole } from "@tendnote/domain";
import type { HouseholdIdentityStore } from "./overview";
import type { HouseholdStore } from "./types";

type HouseholdPlanningFrameStore = Pick<
  HouseholdStore,
  "getHouseholdWorkspace" | "listActiveHouseholdMembershipsForUser" | "listHouseholdMemberships"
>;

export type HouseholdPlanningFrame = {
  householdId: string;
  name: string;
  viewerRole: HouseholdRole;
  members: { userId: string; name: string }[];
};

/**
 * Reads the small admitted-member frame shared Household work needs.
 *
 * This is deliberately narrower than the Account governance Overview: the
 * Household home needs the workspace name, the caller's active role, and names
 * for active-member provenance, but it must not load invitations, capacity,
 * dissolution state, or controls. There is no household id in the input, so a
 * caller cannot point the read at a workspace they are not currently in.
 *
 * Workspace status is proved again after membership lookup. Dissolution ends
 * every membership today, but keeping both gates makes a missed or delayed
 * membership sweep fail closed instead of admitting a member to a dissolved
 * Household. The viewer role comes from that active membership, never from the
 * workspace's historical creator.
 */
export function createHouseholdPlanningFrameReader(
  store: HouseholdPlanningFrameStore,
  identityStore: HouseholdIdentityStore,
) {
  return async function getHouseholdPlanningFrameForUser(input: {
    userId: string;
  }): Promise<HouseholdPlanningFrame | null> {
    const memberships = await store.listActiveHouseholdMembershipsForUser({
      userId: input.userId,
    });
    const viewerMembership = memberships[0];
    if (!viewerMembership) return null;

    const household = await store.getHouseholdWorkspace({
      householdId: viewerMembership.householdId,
    });
    if (household?.status !== "active") return null;

    const roster = await store.listHouseholdMemberships({
      householdId: household.id,
      status: "active",
    });
    const activeViewer = roster.find((membership) => membership.userId === input.userId);
    if (!activeViewer) return null;

    const identities = await identityStore.listUserIdentities({
      userIds: roster.map((membership) => membership.userId),
    });
    const activeUserIds = new Set(roster.map((membership) => membership.userId));
    const members = identities.flatMap<{ userId: string; name: string }>((identity) => {
      if (!activeUserIds.has(identity.id)) return [];
      // This is the same bounded rule used by the active Account roster. An
      // address is only a fallback for a currently admitted member whose
      // account has no display name; invited and former members are never read.
      const name = identity.name?.trim() || identity.email;
      return [{ userId: identity.id, name }];
    });

    return {
      householdId: household.id,
      name: household.name,
      viewerRole: activeViewer.role,
      members,
    };
  };
}
