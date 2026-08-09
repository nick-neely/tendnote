import {
  departureRefusal,
  dissolutionRefusal,
  type GovernanceMember,
  type HouseholdDissolutionProgress,
  type HouseholdRoster,
  householdDissolutionProgress,
  memberRemovalRefusal,
  ownerPromotionRefusal,
  ownerStepDownRefusal,
} from "./household-governance";
import type { HouseholdInvitationSummary } from "./household-invitations";
import { type HouseholdSeatUsage, householdSeatUsage } from "./household-policy";
import type { HouseholdMembership, HouseholdRole } from "./households";

/**
 * Whether one governance action is open to the viewer right now, and — when it
 * is worth saying — why it is not.
 *
 * `blockedReason` is `null` in two different situations that the surface treats
 * identically: the action is simply available, or it does not apply to this
 * viewer at all (a Member has no removal control to explain). A sentence appears
 * only when the viewer could reasonably expect the action and a governance rule
 * is holding it, which is the setup UX's "legible at the attempted action".
 */
export type GovernanceAvailability = {
  available: boolean;
  blockedReason: string | null;
};

export type HouseholdMemberSummary = {
  userId: string;
  name: string;
  email: string;
  role: HouseholdRole;
  /** The person reading the overview, labelled explicitly rather than by position. */
  isViewer: boolean;
  /** A co-owner offer this person has been made and has not answered. */
  awaitingOwnerReply: boolean;
  /** What the viewer may do about this person. Never available to a Member. */
  promote: GovernanceAvailability;
  remove: GovernanceAvailability;
};

/**
 * The authorized read of one Household Workspace for one active member: who is
 * in it, what the reader's own role is, how much of its capacity is spoken for,
 * — for an Owner only — the live invitations they sent, and which governance
 * moves are open to them.
 *
 * `invitations` is empty for a Member by construction rather than by the
 * surface's discretion: sending is an Owner capability, so the addresses an
 * Owner typed are not household-wide information. It carries no audit trail and
 * no other-member private state either way.
 *
 * Every governance field is an answer, not an input: the surface renders what it
 * is told and the same rules are re-decided server-side when a control is
 * pressed, so a stale client can only ever be refused, never obeyed.
 */
export type HouseholdOverview = {
  householdId: string;
  name: string;
  viewerRole: HouseholdRole;
  members: HouseholdMemberSummary[];
  invitations: HouseholdInvitationSummary[];
  seats: HouseholdSeatUsage;
  isSoleMember: boolean;
  /** A co-owner offer waiting on the viewer's own answer. */
  ownerOffer: { offeredByName: string } | null;
  departure: GovernanceAvailability;
  stepDown: GovernanceAvailability;
  /**
   * The unanimous-owner decision to end the household, and how far along it is.
   *
   * `viewerHasConfirmed` is what lets the surface tell the two very different
   * presses apart: adding an agreement to a decision still being made, and
   * casting the one that ends the household now.
   */
  dissolution: GovernanceAvailability &
    HouseholdDissolutionProgress & { viewerHasConfirmed: boolean };
};

export type HouseholdMemberIdentity = {
  id: string;
  name: string | null;
  email: string;
};

/**
 * The offer fields are optional because an omitted one and a null one mean the
 * same thing — no live offer — so a caller assembling a roster without them
 * describes a household correctly rather than having to spell out its absences.
 */
type OverviewMembership = Pick<HouseholdMembership, "userId" | "role" | "status"> &
  Partial<Pick<HouseholdMembership, "pendingRole" | "pendingRoleOfferedByUserId">>;

const UNAVAILABLE: GovernanceAvailability = { available: false, blockedReason: null };

function availability(refusal: string | null, offered: boolean): GovernanceAvailability {
  if (!offered) return UNAVAILABLE;
  return { available: refusal === null, blockedReason: refusal };
}

/**
 * Assembles the overview from active membership rows and the matching account
 * identities.
 *
 * Four invariants are load-bearing. Only `active` memberships are described, so
 * an invited or removed row never reads as a member or occupies a seat. The seat
 * count is derived from those memberships rather than from the joined
 * identities, so an incomplete identity read shows fewer rows instead of
 * understating how full the household is. The seat count adds the live
 * invitations, so an Owner is never shown room that an outstanding invitation
 * has already claimed (ADR 0213). And every governance answer comes from the
 * shared policy seam rather than from a role test written here, so the sentence
 * beside a disabled control is the sentence the server would raise.
 *
 * `memberships` is the whole roster, ended rows included: the governance rules
 * filter to active themselves, and handing them a pre-filtered list would mean
 * two places deciding who counts.
 */
export function buildHouseholdOverview(input: {
  viewerUserId: string;
  household: { id: string; name: string };
  memberships: readonly OverviewMembership[];
  identities: readonly HouseholdMemberIdentity[];
  liveInvitations?: number;
  invitations?: readonly HouseholdInvitationSummary[];
  /** Active owners who have confirmed dissolution. Matched against the roster. */
  dissolutionConfirmations?: readonly string[];
}): HouseholdOverview {
  const roster: HouseholdRoster = input.memberships.map<GovernanceMember>((membership) => ({
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    pendingRole: membership.pendingRole,
  }));
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
  const viewerIsOwner = viewer.role === "owner";

  const identityByUserId = new Map(input.identities.map((identity) => [identity.id, identity]));
  const displayName = (identity: HouseholdMemberIdentity) =>
    identity.name?.trim() || identity.email;

  const members = active.flatMap<HouseholdMemberSummary>((membership) => {
    const identity = identityByUserId.get(membership.userId);
    if (!identity) return [];
    const isViewer = membership.userId === input.viewerUserId;
    return [
      {
        userId: membership.userId,
        name: displayName(identity),
        email: identity.email,
        role: membership.role,
        isViewer,
        awaitingOwnerReply: membership.pendingRole === "owner",
        // A Member is offered nothing about anybody, and nobody is offered a
        // control pointed at themselves — their own moves live below the list.
        promote: availability(
          ownerPromotionRefusal({
            roster,
            actorUserId: input.viewerUserId,
            memberUserId: membership.userId,
          }),
          viewerIsOwner && !isViewer,
        ),
        remove: availability(
          memberRemovalRefusal({
            roster,
            actorUserId: input.viewerUserId,
            memberUserId: membership.userId,
          }),
          viewerIsOwner && !isViewer,
        ),
      },
    ];
  });

  members.sort((left, right) => {
    if (left.isViewer !== right.isViewer) return left.isViewer ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const offeredBy =
    viewer.pendingRole === "owner" && viewer.pendingRoleOfferedByUserId
      ? identityByUserId.get(viewer.pendingRoleOfferedByUserId)
      : undefined;

  return {
    householdId: input.household.id,
    name: input.household.name,
    viewerRole: viewer.role,
    members,
    // An Owner's own invitations; empty for a Member, whatever the caller passed.
    invitations: viewerIsOwner ? [...(input.invitations ?? [])] : [],
    seats: householdSeatUsage({
      activeMembers: active.length,
      liveInvitations: input.liveInvitations ?? input.invitations?.length,
    }),
    isSoleMember: active.length === 1,
    // An offer whose offerer has since left still stands — it was made — so the
    // missing identity falls back to the household rather than dropping the offer.
    ownerOffer:
      viewer.pendingRole === "owner"
        ? { offeredByName: offeredBy ? displayName(offeredBy) : input.household.name }
        : null,
    departure: availability(departureRefusal({ roster, userId: input.viewerUserId }), true),
    stepDown: availability(
      ownerStepDownRefusal({ roster, userId: input.viewerUserId }),
      viewerIsOwner,
    ),
    dissolution: {
      // Offered to everyone, not only to owners, and that asymmetry with
      // `stepDown` is deliberate. The other governance answers are about what
      // one person may do *to another*, which is no business of a Member's. The
      // end of the household is a fact about the Member's own household, so
      // "only an owner can end a household, and every owner has to agree" is
      // theirs to read. It still resolves to `available: false` for them —
      // transparency about the rule, never a control.
      ...availability(dissolutionRefusal({ roster, userId: input.viewerUserId }), true),
      ...householdDissolutionProgress({
        roster,
        confirmedOwnerUserIds: input.dissolutionConfirmations ?? [],
      }),
      viewerHasConfirmed:
        viewerIsOwner && (input.dissolutionConfirmations ?? []).includes(input.viewerUserId),
    },
  };
}
