import { z } from "zod";

export const conversationalCaptureInputModeSchema = z.enum(["typed", "dictated"]);
export const conversationalCaptureSurfaceSchema = z.enum(["global_capture", "eve"]);

export const conversationalCaptureRequestSchema = z
  .object({
    authority: z.literal("explicit"),
    interactionId: z.string().trim().min(1).max(200),
    inputMode: conversationalCaptureInputModeSchema,
    ownerUserId: z.string().trim().min(1),
    originalText: z.string().trim().min(1).max(20_000),
    surface: conversationalCaptureSurfaceSchema,
  })
  .strict();

export const conversationalCaptureChangeRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    savedItemId: z.uuid(),
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const conversationalCaptureUndoRequestSchema = z
  .object({ actorUserId: z.string().trim().min(1), savedItemId: z.uuid() })
  .strict();

export const conversationalCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Saved Items"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      kind: z.enum(["Note", "Link", "Open question"]),
      visibility: z.literal("Only me"),
    }),
    change: z.object({
      kind: z.literal("edit_saved_item"),
      savedItemId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_saved_item"),
      savedItemId: z.string().min(1),
    }),
  })
  .strict();

export type ConversationalCaptureRequest = z.infer<typeof conversationalCaptureRequestSchema>;
export type ConversationalCaptureChangeRequest = z.infer<
  typeof conversationalCaptureChangeRequestSchema
>;
export type ConversationalCaptureUndoRequest = z.infer<
  typeof conversationalCaptureUndoRequestSchema
>;
export type ConversationalCaptureConfirmation = z.infer<
  typeof conversationalCaptureConfirmationSchema
>;
