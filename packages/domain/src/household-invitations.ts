import { z } from "zod";
import { HouseholdValidationError } from "./household-policy";
import type { HouseholdRole } from "./households";

/**
 * A Household Invitation is an email-address-bound, expiring capability — not an
 * early membership (ADR 0213). These five states are the whole lifecycle: one
 * live state and four terminal ones, none of which can return to `pending`.
 */
export const householdInvitationStateSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "canceled",
  "expired",
]);
export type HouseholdInvitationState = z.infer<typeof householdInvitationStateSchema>;

/**
 * How long an invitation stays usable, decided by the household setup UX rather
 * than inherited from an auth library's 48-hour security default: the intended
 * recipient is an adult in someone's home who may not read that mailbox daily,
 * and re-sending is an explicit Owner action either way.
 */
export const HOUSEHOLD_INVITATION_TTL_DAYS = 14;

/**
 * How long an Owner must wait before an explicit resend. A resend rotates the
 * secret, kills the previous link, and sends real mail to someone else's inbox,
 * so a double-press must not become two messages. It is deliberately short: this
 * is a courtesy gap, not the abuse control (that lives in the rate-limit budget).
 */
export const HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * How long an invitation that has ended stays visible to the Owner who sent it.
 *
 * An invitation dies quietly — a decline, an expiry, and a link nobody opened
 * are indistinguishable from the sender's side — so the row outlives its own
 * lifecycle for a week rather than vanishing and leaving the Owner to guess.
 * It holds no seat and offers no action while it lingers.
 */
export const HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_DAYS = 7;
export const HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_MS =
  HOUSEHOLD_INVITATION_RESOLVED_VISIBILITY_DAYS * 24 * 60 * 60 * 1000;

/**
 * The longest address the invitation form accepts. 254 is the practical maximum
 * length of an SMTP forward path, so this bounds input without narrowing what a
 * real mailbox may be called.
 */
export const HOUSEHOLD_INVITATION_EMAIL_LIMIT = 254;

const invitationEmailSchema = z
  .string()
  .trim()
  .min(1, "Enter the email address to invite.")
  .max(HOUSEHOLD_INVITATION_EMAIL_LIMIT, "That email address is too long. Check it and try again.")
  .refine((value) => z.email().safeParse(value).success, {
    message: "That doesn't look like an email address. Check it and try again.",
  });

/**
 * The comparison-safe form of a recipient address: trim and case-fold, nothing
 * else. Provider-specific folding (Gmail's dots, plus-addressing) is deliberately
 * not applied — treating `sam.smith@` and `samsmith@` as one address would send a
 * household capability to a mailbox the Owner never typed.
 */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * What a recipient-side operation is allowed to be told about who is asking:
 * the capability they hold, and the identity their session already proved. Kept
 * as one type so "the session's own identity" is a thing the compiler knows
 * about — an accept or decline can never be handed a user id and an address that
 * came from different places.
 */
export type RecipientProof = {
  /** The emailed secret, exactly as presented. */
  secret: string;
  userId: string;
  /** The session's own address, never one the caller supplied. */
  userEmail: string;
};

export type HouseholdInvitationRecipient = {
  /** Exactly what the Owner typed, minus surrounding whitespace. Shown back to them. */
  email: string;
  /** What every match is decided against. Never shown. */
  normalizedEmail: string;
};

/** Parses a recipient address, raising the curated message a surface can render. */
export function parseInvitationRecipient(email: string): HouseholdInvitationRecipient {
  const parsed = invitationEmailSchema.safeParse(email);
  if (!parsed.success) {
    throw new HouseholdValidationError(
      parsed.error.issues[0]?.message ?? "Enter the email address to invite.",
    );
  }
  return { email: parsed.data, normalizedEmail: normalizeInvitationEmail(parsed.data) };
}

export function householdInvitationExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + HOUSEHOLD_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** The invitation fields every policy decision here is allowed to see. */
export type HouseholdInvitationRecord = {
  id: string;
  householdId: string;
  invitedByUserId: string | null;
  email: string;
  normalizedEmail: string;
  role: HouseholdRole;
  state: HouseholdInvitationState;
  expiresAt: Date;
  lastSentAt: Date | null;
  resendCount: number;
};

/**
 * The state an invitation is actually in right now.
 *
 * Expiry is derived from the clock rather than waited for: a row that no
 * background sweep has rewritten yet must already read — and behave — as
 * expired, or a link would stay usable for as long as nothing happened to touch
 * it. Persisting the flip is a bookkeeping detail of the paths that mutate;
 * every read decides here.
 */
export function effectiveHouseholdInvitationState(
  invitation: Pick<HouseholdInvitationRecord, "state" | "expiresAt">,
  now: Date,
): HouseholdInvitationState {
  if (invitation.state !== "pending") return invitation.state;
  return invitation.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}

/** Whether this invitation still holds a seat and can still be accepted. */
export function isHouseholdInvitationLive(
  invitation: Pick<HouseholdInvitationRecord, "state" | "expiresAt">,
  now: Date,
): boolean {
  return effectiveHouseholdInvitationState(invitation, now) === "pending";
}

/**
 * The neutral lifecycle an Owner may see for their own invitation: the address
 * they typed, where it is in its life, and which of their actions are available.
 *
 * It carries nothing about the recipient — whether they have a Tendnote account,
 * whether they are admitted, whether they belong to another household, or what
 * an email provider knows about them. An invitation is not a lookup tool.
 */
export type HouseholdInvitationSummary = {
  id: string;
  email: string;
  state: HouseholdInvitationState;
  expiresAt: Date;
  canResend: boolean;
  canCancel: boolean;
};

export function summarizeHouseholdInvitation(
  invitation: HouseholdInvitationRecord,
  now: Date,
): HouseholdInvitationSummary {
  const state = effectiveHouseholdInvitationState(invitation, now);
  const live = state === "pending";
  return {
    id: invitation.id,
    email: invitation.email,
    state,
    expiresAt: invitation.expiresAt,
    canResend: live && resendCooldownRemainingMs(invitation, now) === 0,
    canCancel: live,
  };
}

/** How long until an explicit resend is allowed again; `0` when it is allowed now. */
export function resendCooldownRemainingMs(
  invitation: Pick<HouseholdInvitationRecord, "lastSentAt">,
  now: Date,
): number {
  if (!invitation.lastSentAt) return 0;
  const elapsed = now.getTime() - invitation.lastSentAt.getTime();
  return Math.max(0, HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS - elapsed);
}

/**
 * What the person holding an invitation link is allowed to see right now.
 *
 * The ordering is the security contract, so it is written once here rather than
 * reconstructed by each surface:
 *
 * 1. anything not live collapses into a single `unusable` answer, so a link that
 *    never existed, one that was cancelled, one that was declined, one already
 *    consumed, and one that ran out are indistinguishable;
 * 2. nothing about the household is revealed before the invited address is
 *    proven — `sign-in-required` and `address-mismatch` carry no fields at all;
 * 3. only after the proof does the household get named, and the
 *    already-in-a-household conflict still names neither side (ADR 0213).
 */
export type HouseholdJoinDecision =
  | { state: "unusable" }
  | { state: "sign-in-required" }
  | { state: "address-mismatch" }
  | { state: "workspace-conflict" }
  | { state: "ready"; householdName: string; role: HouseholdRole; expiresAt: Date };

export type HouseholdJoinViewer = {
  userId: string;
  email: string;
  /** How many active Household Memberships this viewer already holds. */
  activeHouseholds: number;
};

export function decideHouseholdJoin(input: {
  invitation: {
    invitation: HouseholdInvitationRecord;
    household: { id: string; name: string };
  } | null;
  viewer: HouseholdJoinViewer | null;
  now: Date;
}): HouseholdJoinDecision {
  const found = input.invitation;
  if (!found || !isHouseholdInvitationLive(found.invitation, input.now)) {
    return { state: "unusable" };
  }
  if (!input.viewer) {
    return { state: "sign-in-required" };
  }
  if (normalizeInvitationEmail(input.viewer.email) !== found.invitation.normalizedEmail) {
    return { state: "address-mismatch" };
  }
  if (input.viewer.activeHouseholds > 0) {
    return { state: "workspace-conflict" };
  }
  return {
    state: "ready",
    householdName: found.household.name,
    role: found.invitation.role,
    expiresAt: found.invitation.expiresAt,
  };
}
