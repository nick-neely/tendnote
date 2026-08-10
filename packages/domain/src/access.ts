import { z } from "zod";

/**
 * Private Beta Access status for a Tendnote account/access profile.
 * Only `granted` admits a user into the product; everything else is pending/denied.
 */
export const accessStatusSchema = z.enum(["pending", "granted", "denied"]);

export type AccessStatus = z.infer<typeof accessStatusSchema>;

/** Explains where a granted access decision came from. */
export const accessSourceSchema = z.enum(["bootstrap", "manual_grant", "beta_flag"]);

export type AccessSource = z.infer<typeof accessSourceSchema>;

/** Account-level state for the optional Self Context setup, not a Context Fact. */
export const selfContextOnboardingStatusSchema = z.enum(["not_started", "dismissed", "completed"]);

export type SelfContextOnboardingStatus = z.infer<typeof selfContextOnboardingStatusSchema>;

export const selfContextOnboardingStateSchema = z.object({
  status: selfContextOnboardingStatusSchema,
  reminderAt: z.date().nullable(),
});

export type SelfContextOnboardingState = z.infer<typeof selfContextOnboardingStateSchema>;

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
