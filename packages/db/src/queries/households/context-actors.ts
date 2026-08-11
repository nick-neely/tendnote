import type { HouseholdContextActorIdentity } from "@tendnote/domain";
import type { HouseholdIdentityStore } from "./overview";
import type { HouseholdStore } from "./types";

type HouseholdContextActorStore = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "listHouseholdMemberships"
>;

/**
 * Everyone whose name Household Context attribution may need, including people
 * who have since left.
 *
 * Departed members are read on purpose: their contributions stay the
 * household's, so "Mara · former member" has to remain sayable after she goes
 * (household context management and correction). The set is bounded by the seat
 * limit plus whoever has passed through, and the caller's own active membership
 * is both the lookup key and the standing — there is no household parameter to
 * point this at a workspace the caller was never in.
 *
 * A departed member with no display name is dropped rather than falling back to
 * their email. An active member's address is already on the Overview; a former
 * member's is not, and attribution is not the place to reintroduce it. The
 * attribution helper renders the gap as "someone who's left".
 */
export function createHouseholdContextActorReader(
  store: HouseholdContextActorStore,
  identityStore: HouseholdIdentityStore,
) {
  return async function listHouseholdContextActors(input: {
    userId: string;
  }): Promise<HouseholdContextActorIdentity[]> {
    const memberships = await store.listActiveHouseholdMembershipsForUser({ userId: input.userId });
    const householdId = memberships[0]?.householdId;
    if (!householdId) return [];

    const roster = await store.listHouseholdMemberships({ householdId });
    if (roster.length === 0) return [];

    const activeUserIds = new Set(
      roster.filter((membership) => membership.status === "active").map((m) => m.userId),
    );
    const identities = await identityStore.listUserIdentities({
      userIds: [...new Set(roster.map((membership) => membership.userId))],
    });

    return identities.flatMap<HouseholdContextActorIdentity>((identity) => {
      const isActiveMember = activeUserIds.has(identity.id);
      const name = identity.name?.trim();
      if (!name && !isActiveMember) return [];
      return [{ userId: identity.id, name: name || identity.email, isActiveMember }];
    });
  };
}
