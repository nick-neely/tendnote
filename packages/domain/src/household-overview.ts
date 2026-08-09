import type { HouseholdInvitationSummary } from "./household-invitations";
import { type HouseholdSeatUsage, householdSeatUsage } from "./household-policy";
import type { HouseholdMembership, HouseholdRole } from "./households";

export type HouseholdMemberSummary = {
  userId: string;
  name: string;
  email: string;
  role: HouseholdRole;
  /** The person reading the overview, labelled explicitly rather than by position. */
  isViewer: boolean;
};

/**
 * The authorized read of one Household Workspace for one active member: who is
 * in it, what the reader's own role is, how much of its capacity is spoken for,
 * and — for an Owner only — the live invitations they sent.
 *
 * `invitations` is empty for a Member by construction rather than by the
 * surface's discretion: sending is an Owner capability, so the addresses an
 * Owner typed are not household-wide information. It carries no audit trail and
 * no other-member private state either way.
 */
export type HouseholdOverview = {
  householdId: string;
  name: string;
  viewerRole: HouseholdRole;
  members: HouseholdMemberSummary[];
  invitations: HouseholdInvitationSummary[];
  seats: HouseholdSeatUsage;
  isSoleMember: boolean;
};

export type HouseholdMemberIdentity = {
  id: string;
  name: string | null;
  email: string;
};

type OverviewMembership = Pick<HouseholdMembership, "userId" | "role" | "status">;

/**
 * Assembles the overview from active membership rows and the matching account
 * identities.
 *
 * Three invariants are load-bearing. Only `active` memberships are described, so
 * an invited or removed row never reads as a member or occupies a seat. The seat
 * count is derived from those memberships rather than from the joined
 * identities, so an incomplete identity read shows fewer rows instead of
 * understating how full the household is. And the seat count adds the live
 * invitations, so an Owner is never shown room that an outstanding invitation
 * has already claimed (ADR 0213).
 */
export function buildHouseholdOverview(input: {
  viewerUserId: string;
  household: { id: string; name: string };
  memberships: readonly OverviewMembership[];
  identities: readonly HouseholdMemberIdentity[];
  liveInvitations?: number;
  invitations?: readonly HouseholdInvitationSummary[];
}): HouseholdOverview {
  const active = input.memberships.filter((membership) => membership.status === "active");
  const viewer = active.find((membership) => membership.userId === input.viewerUserId);
  if (!viewer) {
    // Unreachable through the shipped reader, which finds the household *via*
    // the caller's own active membership and answers `null` before reaching
    // here. It is defended anyway because this function is the only thing
    // standing between a caller id and a description of a household's people:
    // a future caller that resolves the household some other way must fail
    // closed rather than render someone else's membership state. Not a curated
    // HouseholdValidationError - there is no user action that recovers from it.
    throw new Error("Active household membership required.");
  }

  const identityByUserId = new Map(input.identities.map((identity) => [identity.id, identity]));
  const members = active.flatMap<HouseholdMemberSummary>((membership) => {
    const identity = identityByUserId.get(membership.userId);
    if (!identity) return [];
    return [
      {
        userId: membership.userId,
        name: identity.name?.trim() || identity.email,
        email: identity.email,
        role: membership.role,
        isViewer: membership.userId === input.viewerUserId,
      },
    ];
  });

  members.sort((left, right) => {
    if (left.isViewer !== right.isViewer) return left.isViewer ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    householdId: input.household.id,
    name: input.household.name,
    viewerRole: viewer.role,
    members,
    // An Owner's own invitations; empty for a Member, whatever the caller passed.
    invitations: viewer.role === "owner" ? [...(input.invitations ?? [])] : [],
    seats: householdSeatUsage({
      activeMembers: active.length,
      liveInvitations: input.liveInvitations ?? input.invitations?.length,
    }),
    isSoleMember: active.length === 1,
  };
}
