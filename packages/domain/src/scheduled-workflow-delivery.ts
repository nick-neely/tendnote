import { z } from "zod";
import type { Sensitivity } from "./privacy";

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
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ScheduledWorkflowDeliverySetting = z.infer<
  typeof scheduledWorkflowDeliverySettingSchema
>;

export const upsertScheduledWorkflowDeliverySettingSchema =
  scheduledWorkflowDeliverySettingSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
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
  persisted: true;
  summary: string;
};
