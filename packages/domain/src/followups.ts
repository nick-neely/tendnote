import { z } from "zod";

export const followupStatusSchema = z.enum(["open", "completed", "snoozed", "dismissed"]);

export const followupSchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  reason: z.string().min(1),
  dueAt: z.date(),
  status: followupStatusSchema.default("open"),
  cadence: z.string().nullable().optional(),
  lastPromptedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createFollowupSchema = followupSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Followup = z.infer<typeof followupSchema>;
export type FollowupStatus = z.infer<typeof followupStatusSchema>;
export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;
