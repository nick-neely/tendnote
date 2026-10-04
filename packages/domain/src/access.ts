import { z } from "zod";
import { RETENTION } from "./retention";

/**
 * Private Beta Access status for a Tendnote account/access profile.
 * Only `granted` admits a user into the product; everything else is pending/denied.
 */
export const accessStatusSchema = z.enum(["pending", "granted", "denied"]);

export type AccessStatus = z.infer<typeof accessStatusSchema>;

/** Explains where a granted access decision came from. */
export const accessSourceSchema = z.enum([
  "bootstrap",
  "self_hosted_bootstrap",
  "household_invitation",
  "manual_grant",
  "beta_flag",
  "paid_access",
]);

export type AccessSource = z.infer<typeof accessSourceSchema>;

/** Account-level state for the optional Self Context setup, not a Context Fact. */
export const selfContextOnboardingStatusSchema = z.enum(["not_started", "dismissed", "completed"]);

export type SelfContextOnboardingStatus = z.infer<typeof selfContextOnboardingStatusSchema>;

export const selfContextOnboardingStateSchema = z.object({
  status: selfContextOnboardingStatusSchema,
  reminderAt: z.date().nullable(),
});

export type SelfContextOnboardingState = z.infer<typeof selfContextOnboardingStateSchema>;

/**
 * The account-level Approval Mode for Eve's gated tool calls: `ask` waits for an
 * Owner Approval on every one, `trusted` lets a Reversible Private Write run
 * immediately in a conversation that is not tainted (#549).
 */
export const eveApprovalModeSchema = z.enum(["ask", "trusted"]);

export type EveApprovalMode = z.infer<typeof eveApprovalModeSchema>;

export const accessProfileSchema = z.object({
  userId: z.string(),
  status: accessStatusSchema,
  source: accessSourceSchema.nullable(),
  grantedAt: z.date().nullable(),
  selfContextOnboardingStatus: selfContextOnboardingStatusSchema,
  selfContextOnboardingReminderAt: z.date().nullable(),
  /**
   * Whether this member has asked for a Household Check-in in their own briefing
   * (#390).
   *
   * It lives on the access profile rather than beside the brief schedules it
   * shows up in, because a member always has an access profile and may not yet
   * have a briefing row — and a preference stored on a row that might not exist
   * is a control that reports success while doing nothing. Default `false`: a
   * Check-in is offered, never assumed, and no member may enable one for another
   * (ADR 0220).
   */
  householdCheckinEnabled: z.boolean().default(false),
  /**
   * This user's Approval Mode for Eve's gated tool calls (#549).
   *
   * It lives on the access profile for the same reason the Household Check-in
   * opt-in does: this row always exists for an admitted user, so the account
   * setting can never succeed against nothing. Default `ask` - `trusted` is a
   * choice the user makes for themselves in their own account settings, and
   * nothing the model, the chat, or the browser supplies can select one. Only
   * the owner of this profile sets it; there is deliberately no form of this
   * that names anybody else.
   */
  eveApprovalMode: eveApprovalModeSchema.default("ask"),
  /**
   * When a Lapsed Account's content is deleted unless it is admitted again
   * (ADR 0245). Written once, on entering Lapsed, from
   * {@link lapsedRetentionDeadline}; any later grant clears it. Present only on
   * a not-admitted profile, and its presence is what makes the account Lapsed
   * rather than never paid.
   */
  retentionDeadline: z.date().nullable().default(null),
  /**
   * The Stripe subscription whose first paid invoice granted Paid Access
   * (#609). Only that subscription's end can lapse the account, so a late end
   * of an older one never touches an account a resubscription admitted.
   */
  paidAccessSubscriptionId: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AccessProfile = z.infer<typeof accessProfileSchema>;

/**
 * The retention deadline of an account that entered Lapsed at `lapsedAt`. It is
 * computed once, on entry, and stored, so the copy, the notice emails, and the
 * deletion sweep all read the same instant and a later change to the constant
 * never moves a deadline already promised.
 */
export function lapsedRetentionDeadline(lapsedAt: Date): Date {
  return new Date(lapsedAt.getTime() + RETENTION.lapsedAccount.days * 24 * 60 * 60 * 1000);
}

/**
 * The retention deadline of an account terminated at `terminatedAt` (#630),
 * computed once and stored on the termination for the same reason as
 * {@link lapsedRetentionDeadline}.
 */
export function terminationRetentionDeadline(terminatedAt: Date): Date {
  return new Date(terminatedAt.getTime() + RETENTION.terminatedAccount.days * 24 * 60 * 60 * 1000);
}

/**
 * How long an account stays admitted, as Past Due, after a renewal payment
 * fails: seven days (ADR 0245). Stripe's retries do the mechanical work; this is
 * Tendnote's policy, closed by the reconciliation job. Stripe's own retry
 * schedule must outlast it, or a cancellation by Stripe would end access first.
 */
const DUNNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When the dunning window of a renewal that failed at `pastDueSince` closes
 * and the account becomes Lapsed. The notice's days remaining and the sweep
 * that closes the window both read this one instant.
 */
export function dunningWindowEnd(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + DUNNING_WINDOW_MS);
}

/**
 * The latest instant a renewal can have failed at and still have its dunning
 * window closed by `now`: the inverse of {@link dunningWindowEnd}, for the
 * sweep that finds every closed window.
 */
export function dunningWindowsClosedBy(now: Date): Date {
  return new Date(now.getTime() - DUNNING_WINDOW_MS);
}

/**
 * Result of the shared access-check seam. `admitted` is the single signal pages,
 * server actions, and Eve ingress should branch on; it never loads relationship data.
 */
export type AccessDecision = {
  admitted: boolean;
  status: AccessStatus;
  profile: AccessProfile | null;
  /**
   * Set only on a hosted account that is not admitted but is a live Household
   * Guest of this household: read-only, never `admitted`, so every surface that
   * branches on `admitted` keeps refusing it (ADR 0245).
   */
  guest?: { householdId: string };
};
