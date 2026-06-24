import { z } from "zod";

export const messageDraftChannelSchema = z.enum(["text", "email", "slack", "other"]);

export const messageDraftPurposeSchema = z.enum([
  "birthday",
  "thank_you",
  "check_in",
  "networking",
  "other",
]);

export const messageDraftStatusSchema = z.enum(["draft", "approved", "dismissed", "sent_manually"]);

export const messageDraftSchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  channel: messageDraftChannelSchema.default("text"),
  purpose: messageDraftPurposeSchema.default("other"),
  body: z.string().min(1),
  status: messageDraftStatusSchema.default("draft"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createMessageDraftSchema = messageDraftSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MessageDraft = z.infer<typeof messageDraftSchema>;
export type MessageDraftChannel = z.infer<typeof messageDraftChannelSchema>;
export type MessageDraftPurpose = z.infer<typeof messageDraftPurposeSchema>;
export type MessageDraftStatus = z.infer<typeof messageDraftStatusSchema>;
export type CreateMessageDraftInput = z.infer<typeof createMessageDraftSchema>;
