import {
  buildHouseholdOverview,
  type HouseholdMemberIdentity,
  type HouseholdOverview,
} from "@tendnote/domain";
import { inArray } from "drizzle-orm";
import { getDb } from "../../client";
import { user } from "../../schema";
import type { HouseholdStore } from "./types";

/** The account identities an overview needs to show people rather than user ids. */
export type HouseholdIdentityStore = {
  listUserIdentities: (input: { userIds: string[] }) => Promise<HouseholdMemberIdentity[]>;
};

export function createDrizzleHouseholdIdentityStore(): HouseholdIdentityStore {
  return {
    async listUserIdentities(input) {
      if (input.userIds.length === 0) return [];
      return getDb()
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, input.userIds));
    },
  };
}

/**
 * Reads the caller's own Household Overview, or `null` when they have no active
 * membership.
 *
 * The caller's active membership is both the lookup key and the authorization:
 * there is no household parameter to point at someone else's workspace, so the
 * read can only ever describe a household the caller is currently in.
 */
export function createHouseholdOverviewReader(
  store: HouseholdStore,
  identityStore: HouseholdIdentityStore,
) {
  return async function getHouseholdOverviewForUser(input: {
    userId: string;
  }): Promise<HouseholdOverview | null> {
    const memberships = await store.listActiveHouseholdMembershipsForUser({ userId: input.userId });
    const householdId = memberships[0]?.householdId;
    if (!householdId) return null;

    const household = await store.getHouseholdWorkspace({ householdId });
    if (!household) return null;

    const activeMemberships = await store.listHouseholdMemberships({
      householdId,
      status: "active",
    });
    const identities = await identityStore.listUserIdentities({
      userIds: activeMemberships.map((membership) => membership.userId),
    });

    return buildHouseholdOverview({
      viewerUserId: input.userId,
      household,
      memberships: activeMemberships,
      identities,
    });
  };
}
