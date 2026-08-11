import {
  buildHouseholdOverview,
  type HouseholdInvitationSummary,
  type HouseholdMemberIdentity,
  type HouseholdOverview,
} from "@tendnote/domain";
import { inArray } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import { user } from "../../schema";
import type { HouseholdStore } from "./types";

/** The account identities an overview needs to show people rather than user ids. */
export type HouseholdIdentityStore = {
  listUserIdentities: (input: { userIds: string[] }) => Promise<HouseholdMemberIdentity[]>;
};

export function createDrizzleHouseholdIdentityStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdIdentityStore {
  return {
    async listUserIdentities(input) {
      if (input.userIds.length === 0) return [];
      return resolveDb()
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
/**
 * The invitation state the Overview is allowed to see. A narrow port rather than
 * the whole lifecycle: the Overview reads, it never sends, cancels, or accepts.
 */
export type HouseholdOverviewInvitationReader = {
  listInvitationsForOwner: (input: {
    ownerUserId: string;
  }) => Promise<HouseholdInvitationSummary[]>;
  countLiveInvitations: (input: { householdId: string }) => Promise<number>;
};

export function createHouseholdOverviewReader(
  store: HouseholdStore,
  identityStore: HouseholdIdentityStore,
  invitationReader?: HouseholdOverviewInvitationReader,
) {
  return async function getHouseholdOverviewForUser(input: {
    userId: string;
  }): Promise<HouseholdOverview | null> {
    const memberships = await store.listActiveHouseholdMembershipsForUser({ userId: input.userId });
    const householdId = memberships[0]?.householdId;
    if (!householdId) return null;

    const household = await store.getHouseholdWorkspace({ householdId });
    if (!household) return null;

    // The whole roster, ended rows included: the governance rules filter to
    // active themselves, and a pre-filtered list would mean two places deciding
    // who counts. Only active members get an identity read — a departed member
    // is not a person this surface describes.
    const memberRoster = await store.listHouseholdMemberships({ householdId });
    const identities = await identityStore.listUserIdentities({
      userIds: memberRoster
        .filter((membership) => membership.status === "active")
        .map((membership) => membership.userId),
    });
    const confirmations = await store.listHouseholdDissolutionConfirmations({ householdId });

    // The seat count comes from the household's own live invitations, while the
    // rows come from the caller's role-filtered view: a Member must see how full
    // the household is without seeing the addresses an Owner typed.
    const [liveInvitations, invitations] = invitationReader
      ? await Promise.all([
          invitationReader.countLiveInvitations({ householdId }),
          invitationReader.listInvitationsForOwner({ ownerUserId: input.userId }),
        ])
      : [0, []];

    return buildHouseholdOverview({
      viewerUserId: input.userId,
      household,
      memberships: memberRoster,
      identities,
      liveInvitations,
      invitations,
      dissolutionConfirmations: confirmations.map((confirmation) => confirmation.userId),
    });
  };
}
