import { z } from "zod";

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
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AccessProfile = z.infer<typeof accessProfileSchema>;

/**
 * Result of the shared access-check seam. `admitted` is the single signal pages,
 * server actions, and Eve ingress should branch on; it never loads relationship data.
 */
export type AccessDecision = {
  admitted: boolean;
  status: AccessStatus;
  profile: AccessProfile | null;
};
