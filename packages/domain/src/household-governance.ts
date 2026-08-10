import { HouseholdValidationError } from "./household-policy";
import type { HouseholdMembership, HouseholdRole } from "./households";

/**
 * One person's standing in a household, as governance sees them.
 *
 * `pendingRole` is an offer that has been made and not answered — the recipient
 * is still exactly what `role` says they are. Keeping the offer beside the role
 * rather than in place of it is what makes "promotion requires acceptance"
 * (ADR 0213) a fact about the data instead of a convention the callers keep.
 */
export type GovernanceMember = Pick<HouseholdMembership, "userId" | "role" | "status"> & {
  pendingRole?: HouseholdRole | null;
};

/**
 * Every membership row of one household, active and ended alike.
 *
 * Ended rows are included on purpose. They are what makes "the person you are
 * pointing at is no longer here" answerable, and every rule that protects the
 * household — last owner, unanimity — filters to active itself rather than
 * trusting the caller to have done it.
 */
export type HouseholdRoster = readonly GovernanceMember[];

/**
 * The single, protected end of a Household Workspace.
 *
 * The window is a product commitment rather than a storage detail: for a month
 * after a household ends, support can still put it back, and the number is here
 * so the copy that promises it and the sweep that will eventually close it read
 * the same value.
 *
 * The window is also the erasure boundary, not only the recovery one: when it
 * closes, the purge sweep disposes of the workspace's own records and the
 * workspace row, leaving the minimized non-content audit tombstone (#391).
 * Recovery stopping and deletion happening are the same moment on purpose —
 * a gap between them would be a period in which Tendnote holds a household's
 * content it has already told everyone it can no longer put back.
 */
export const HOUSEHOLD_RECOVERY_WINDOW_DAYS = 30;

export function householdRecoveryDeadline(dissolvedAt: Date): Date {
  return new Date(dissolvedAt.getTime() + HOUSEHOLD_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Whether this household's content may now be disposed of.
 *
 * Inclusive of the deadline itself, matching the copy: "thirty days" ends when
 * the thirtieth day is up, not a millisecond later. A household with no
 * `dissolvedAt` is never due whatever its status says — an absent moment is not
 * an old one, and inferring "long enough ago" from a missing value is how a live
 * workspace gets deleted.
 */
export function isHouseholdPurgeDue(input: { dissolvedAt: Date | null; now: Date }): boolean {
  if (!input.dissolvedAt) return false;
  return householdRecoveryDeadline(input.dissolvedAt).getTime() <= input.now.getTime();
}

/**
 * The same boundary expressed as a `dissolved_at` the sweep can compare against
 * in SQL, so the index on `(status, dissolved_at)` selects candidates rather
 * than the job filtering a scan in memory.
 *
 * Deliberately the inverse of {@link householdRecoveryDeadline} rather than a
 * second definition of the window: `dissolved_at <= cutoff` and
 * `deadline <= now` are the same sentence, and a test pins that they agree.
 */
export function householdPurgeCutoff(now: Date): Date {
  return new Date(now.getTime() - HOUSEHOLD_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Why there is no "recover my household" button, written once.
 *
 * An Owner who has lost access to their account is exactly the shape an attacker
 * imitates, so the recovery path is evidence-based and human-reviewed. Anything
 * self-service here would be a standing authority bypass around every other rule
 * in this file (ADR 0213, household privacy and recovery evidence).
 */
export const HOUSEHOLD_RECOVERY_IS_SUPPORT_ONLY =
  "Getting a household back is handled by support, with proof of who you are. There's no way to do it from inside Tendnote, and no way for anyone else here to take it over.";

/**
 * Where "handled by support" actually leads.
 *
 * Naming support without naming a way to reach them is a boundary with no door,
 * so the address travels with the sentence above and every surface that shows
 * one shows the other. Kept beside the copy rather than in the surface so the
 * two cannot drift apart.
 */
export const HOUSEHOLD_SUPPORT_EMAIL = "support@tendnote.com";

/**
 * What someone is told when the household they were acting on is no longer one
 * they stand in.
 *
 * This is a stale screen, not a broken one: between the render and the press,
 * the household ended, or their place in it changed. It is curated for that
 * reason — a person whose next move is "reload and look again" must not be told
 * to try the same press again, which is what the generic failure would say.
 * Which of the two happened is deliberately not guessed at: distinguishing them
 * would mean reading a household the caller no longer belongs to.
 */
export const HOUSEHOLD_STANDING_ENDED =
  "You're not in this household any more — it may have ended, or your place in it may have changed. Reload the page to see where things stand.";

const GONE = "That person is no longer in this household.";

/** The active members of a household, in roster order. */
export function activeHouseholdMembers(roster: HouseholdRoster): GovernanceMember[] {
  return roster.filter((member) => member.status === "active");
}

/** The active owners of a household. The rule behind every protection here. */
export function activeHouseholdOwners(roster: HouseholdRoster): GovernanceMember[] {
  return activeHouseholdMembers(roster).filter((member) => member.role === "owner");
}

function activeMember(roster: HouseholdRoster, userId: string): GovernanceMember | undefined {
  return roster.find((member) => member.userId === userId && member.status === "active");
}

/**
 * Whether the given person is the only thing standing between this household and
 * having nobody who can govern it.
 */
function isLastActiveOwner(roster: HouseholdRoster, userId: string): boolean {
  const owners = activeHouseholdOwners(roster);
  return owners.length === 1 && owners[0]?.userId === userId;
}

/**
 * Why an offer of co-ownership cannot be made right now, or `null` when it can.
 *
 * The refusal form is the primary one and the `assert*` pair below is built on
 * it, so the sentence a surface shows beside a disabled control and the sentence
 * the lifecycle raises when it is pressed anyway are the same sentence. Two
 * copies of a governance rule drift, and drift here means a control that offers
 * something the server refuses.
 *
 * Note what is *not* checked: whether the actor is an owner. Authorization is
 * the lifecycle's job and answers with its own uncurated failure; this file
 * decides governance among people who are already allowed to act.
 */
export function ownerPromotionRefusal(input: {
  roster: HouseholdRoster;
  actorUserId: string;
  memberUserId: string;
}): string | null {
  const target = activeMember(input.roster, input.memberUserId);
  if (!target) return GONE;
  if (target.role === "owner") {
    return input.memberUserId === input.actorUserId
      ? "You're already an owner here."
      : "They're already an owner here.";
  }
  if (target.pendingRole) {
    return "They've already been asked. It's theirs to accept whenever they're ready.";
  }
  return null;
}

export function assertOwnerPromotionAllowed(input: {
  roster: HouseholdRoster;
  actorUserId: string;
  memberUserId: string;
}): void {
  raise(ownerPromotionRefusal(input));
}

/**
 * Why one person cannot remove another right now, or `null` when they can.
 *
 * The co-owner protection is absolute and deliberately has no override: an Owner
 * is removed only by their own departure or by the household ending, both of
 * which are their own consent (ADR 0213).
 */
export function memberRemovalRefusal(input: {
  roster: HouseholdRoster;
  actorUserId: string;
  memberUserId: string;
}): string | null {
  if (input.memberUserId === input.actorUserId) {
    return "Leaving is yours to do — use Leave household instead.";
  }
  const target = activeMember(input.roster, input.memberUserId);
  if (!target) return GONE;
  if (target.role === "owner") {
    return "Owners can't remove another owner. They can step down or leave whenever they choose.";
  }
  return null;
}

export function assertMemberRemovalAllowed(input: {
  roster: HouseholdRoster;
  actorUserId: string;
  memberUserId: string;
}): void {
  raise(memberRemovalRefusal(input));
}

/**
 * Why this person cannot leave right now, or `null` when they can.
 *
 * The last active Owner is held, and the two ways that happens get different
 * sentences because they have different exits: an Owner with people around them
 * needs one of those people to accept co-ownership, while an Owner alone in a
 * household has nobody to ask and is really being told that ending it is the
 * door they want.
 */
export function departureRefusal(input: {
  roster: HouseholdRoster;
  userId: string;
}): string | null {
  const member = activeMember(input.roster, input.userId);
  if (!member) return GONE;
  if (!isLastActiveOwner(input.roster, input.userId)) return null;

  return activeHouseholdMembers(input.roster).length === 1
    ? "You're the only person here, so there's nobody to hand the household to. Ending it is how you close it."
    : "You're the only owner. Ask someone here to become an owner too — once they accept, you can leave.";
}

export function assertDepartureAllowed(input: { roster: HouseholdRoster; userId: string }): void {
  raise(departureRefusal(input));
}

/**
 * Why this Owner cannot step down to member right now, or `null` when they can.
 *
 * Stepping down is the gentler half of the last-owner rule: it lets someone stop
 * governing without leaving the household or the people in it.
 */
export function ownerStepDownRefusal(input: {
  roster: HouseholdRoster;
  userId: string;
}): string | null {
  const member = activeMember(input.roster, input.userId);
  if (!member) return GONE;
  if (member.role !== "owner") return "You're not an owner here.";
  if (isLastActiveOwner(input.roster, input.userId)) {
    return "You're the only owner. Someone else here needs to accept co-ownership first.";
  }
  return null;
}

export function assertOwnerStepDownAllowed(input: {
  roster: HouseholdRoster;
  userId: string;
}): void {
  raise(ownerStepDownRefusal(input));
}

/** Why this person cannot move to end the household, or `null` when they can. */
export function dissolutionRefusal(input: {
  roster: HouseholdRoster;
  userId: string;
}): string | null {
  const member = activeMember(input.roster, input.userId);
  if (!member) return GONE;
  if (member.role !== "owner") {
    return "Only an owner can end a household.";
  }
  return null;
}

export function assertDissolutionAllowed(input: { roster: HouseholdRoster; userId: string }): void {
  raise(dissolutionRefusal(input));
}

export type HouseholdDissolutionProgress = {
  /** How many active owners must confirm. */
  required: number;
  /** How many of them have. */
  confirmed: number;
  /** The active owners who have not confirmed yet. */
  awaitingUserIds: string[];
  unanimous: boolean;
};

/**
 * How close a household is to the unanimous active-Owner decision that ends it.
 *
 * Confirmations are matched against the roster as it is *now*, so a confirmation
 * from someone who has since left, been removed, or stepped down counts for
 * nothing. Anything else would let a household be ended by a set of owners that
 * no longer exists.
 *
 * A household with no active owners is never unanimous. That state should be
 * unreachable — the last-owner rule exists to keep it so — but a household
 * nobody governs must not become one anybody can end.
 */
export function householdDissolutionProgress(input: {
  roster: HouseholdRoster;
  confirmedOwnerUserIds: readonly string[];
}): HouseholdDissolutionProgress {
  const owners = activeHouseholdOwners(input.roster);
  const confirmed = new Set(input.confirmedOwnerUserIds);
  const awaitingUserIds = owners
    .filter((owner) => !confirmed.has(owner.userId))
    .map((owner) => owner.userId);

  return {
    required: owners.length,
    confirmed: owners.length - awaitingUserIds.length,
    awaitingUserIds,
    unanimous: owners.length > 0 && awaitingUserIds.length === 0,
  };
}

function raise(refusal: string | null): void {
  if (refusal) throw new HouseholdValidationError(refusal);
}
