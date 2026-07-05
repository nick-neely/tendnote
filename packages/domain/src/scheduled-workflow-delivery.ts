import { z } from "zod";
import { type PrivacyScope, privacyScopeSchema, type Sensitivity } from "./privacy";

export const phase3ScheduledWorkflowSchema = z.enum([
  "morning_agenda",
  "post_meeting_aftercare",
  "weekly_relationship_review",
  "birthday_gift_planning",
]);
export type Phase3ScheduledWorkflow = z.infer<typeof phase3ScheduledWorkflowSchema>;

export const proactiveDeliveryChannelSchema = z.enum(["discord"]);
export type ProactiveDeliveryChannel = z.infer<typeof proactiveDeliveryChannelSchema>;

export const proactiveDeliveryStatusSchema = z.enum(["sent", "skipped", "failed"]);
export type ProactiveDeliveryStatus = z.infer<typeof proactiveDeliveryStatusSchema>;

export const scheduledArtifactKindSchema = z.enum([
  "morning_agenda",
  "post_meeting_aftercare",
  "weekly_relationship_review",
  "birthday_gift_planning",
  "brief",
]);
export type ScheduledArtifactKind = z.infer<typeof scheduledArtifactKindSchema>;

export const scheduledWorkflowDeliverySettingSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  workflow: phase3ScheduledWorkflowSchema,
  channel: proactiveDeliveryChannelSchema,
  enabled: z.boolean().default(true),
  targetId: z.string().min(1),
  allowSensitive: z.boolean().default(false),
  /**
   * Disclosure scope of the configured Discord destination. `private` (the
   * fail-closed default) is an owner-only destination that is safe for the
   * owner's own artifacts of any scope. A non-private target is a shared channel
   * that additional household/private gating applies to.
   */
  targetScope: privacyScopeSchema.default("private"),
  /**
   * Household a `household`-scoped target serves. Household-scoped artifacts are
   * only delivered when this matches the artifact's household, so an owner's
   * household channel can never receive another household's content.
   */
  targetHouseholdId: z.string().nullable().default(null),
  /**
   * Explicit opt-in to post a private owner artifact's safe summary to a
   * shared/household target. Off by default: private content stays on private
   * targets unless the owner deliberately allows a summary onto a shared channel.
   */
  allowPrivateSummary: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ScheduledWorkflowDeliverySetting = z.infer<
  typeof scheduledWorkflowDeliverySettingSchema
>;

export const upsertScheduledWorkflowDeliverySettingSchema = scheduledWorkflowDeliverySettingSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  // Target-scope policy is optional to configure. On a first insert an omitted
  // value takes the fail-closed default (a `private`, owner-only target), so
  // callers must opt in to shared/household delivery rather than opt out. On a
  // conflict-update an omitted value is skipped, preserving the stored policy
  // (the same preserve-on-undefined semantics as the install record).
  .partial({
    targetScope: true,
    targetHouseholdId: true,
    allowPrivateSummary: true,
  });
export type UpsertScheduledWorkflowDeliverySettingInput = z.infer<
  typeof upsertScheduledWorkflowDeliverySettingSchema
>;

export const scheduledWorkflowDeliveryAttemptSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  workflow: phase3ScheduledWorkflowSchema,
  channel: proactiveDeliveryChannelSchema,
  artifactKind: scheduledArtifactKindSchema,
  artifactId: z.string(),
  targetId: z.string().nullable().default(null),
  status: proactiveDeliveryStatusSchema,
  reason: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ScheduledWorkflowDeliveryAttempt = z.infer<
  typeof scheduledWorkflowDeliveryAttemptSchema
>;

export const createScheduledWorkflowDeliveryAttemptSchema =
  scheduledWorkflowDeliveryAttemptSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateScheduledWorkflowDeliveryAttemptInput = z.infer<
  typeof createScheduledWorkflowDeliveryAttemptSchema
>;

export type ScheduledWorkflowDeliveryArtifact = {
  ownerUserId: string;
  workflow: Phase3ScheduledWorkflow;
  artifactKind: ScheduledArtifactKind;
  artifactId: string;
  sensitivity: Sensitivity;
  /**
   * Visibility scope of the artifact's underlying content. Omitted is treated as
   * `private` (fail-closed): an artifact of unknown scope is never posted to a
   * shared/household Discord target.
   */
  scope?: PrivacyScope;
  /** Household the artifact belongs to, required for household-scoped delivery. */
  householdId?: string | null;
  persisted: true;
  summary: string;
};
