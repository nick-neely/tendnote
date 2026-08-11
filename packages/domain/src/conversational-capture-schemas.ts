import { z } from "zod";
import { selfContextFactCategorySchema } from "./context-facts";
import { sensitivitySchema } from "./privacy";
export const conversationalCaptureInputModeSchema = z.enum(["typed", "dictated"]);
export const conversationalCaptureSurfaceSchema = z.enum(["global_capture", "eve"]);
export const conversationalCaptureVisibilitySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("private") }).strict(),
  z
    .object({
      scope: z.literal("household"),
      householdId: z.string().min(1),
      label: z.string().trim().min(1).max(120).default("Household"),
    })
    .strict(),
  z
    .object({
      scope: z.literal("shared"),
      householdId: z.string().min(1),
      selectedUserIds: z.array(z.string().min(1)).min(1),
      label: z.string().trim().min(1).max(120),
    })
    .strict(),
]);
export const conversationalCaptureInferredSuggestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("memory"),
      personId: z.string().min(1),
      personName: z.string().trim().min(1).max(120),
      content: z.string().trim().min(1).max(4_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      assetName: z.string().trim().min(1).max(240),
      assetKind: z.enum(["item", "appliance", "vehicle", "subscription", "service", "property"]),
      fact: z.string().trim().min(1).max(4_000).optional(),
    })
    .strict(),
]);

/**
 * The scope a caller *chose*, as opposed to the audience a resolver worked out.
 *
 * Deliberately just the word, with no household id and no member list. A Capture
 * that accepted an id would let whatever produced the request — a UI control, a
 * model turn, a replayed job — name a workspace, and "the household the caller
 * says they are in" is exactly the assertion the Household Authorization Proof
 * exists to refuse. `household` here means "the one household this caller is
 * currently an active member of", which the seam reads from their own membership
 * rows at the moment of the write (ADR 0219, ADR 0220).
 */
export const conversationalCaptureRequestedScopeSchema = z.enum(["private", "household"]);
export type ConversationalCaptureRequestedScope = z.infer<
  typeof conversationalCaptureRequestedScopeSchema
>;

export const conversationalCaptureRequestSchema = z
  .object({
    authority: z.literal("explicit"),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    contextVisibility: conversationalCaptureVisibilitySchema.optional(),
    /**
     * Set only by a deliberate scope control. Absent means private, which is what
     * a caller who did not choose gets: widening is always explicit (ADR 0153),
     * and conversational wording is never the choice.
     */
    requestedScope: conversationalCaptureRequestedScopeSchema.optional(),
    interactionId: z.string().trim().min(1).max(200),
    inputMode: conversationalCaptureInputModeSchema,
    inferredSuggestions: z.array(conversationalCaptureInferredSuggestionSchema).max(4).optional(),
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

export const conversationalCaptureChangeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit_saved_item"), savedItemId: z.uuid() }).strict(),
  z.object({ kind: z.literal("edit_general_action"), generalActionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("edit_followup"), followupId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("edit_person"),
      personId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      createdByCapture: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edit_memory"),
      memoryId: z.string().min(1),
      sourceRecordId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edit_asset_review"),
      groupId: z.string().min(1),
      sourceRecordId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edit_context_fact"),
      contextFactId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      expectedUpdatedAt: z.iso.datetime().optional(),
    })
    .strict(),
]);

export const conversationalCaptureUndoTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("archive_saved_item"), savedItemId: z.uuid() }).strict(),
  z.object({ kind: z.literal("archive_general_action"), generalActionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("archive_followup"), followupId: z.uuid() }).strict(),
  z.object({ kind: z.literal("archive_memory"), memoryId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("dismiss_asset_review"), groupId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("archive_context_fact"),
      contextFactId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      expectedUpdatedAt: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edit_context_fact"),
      contextFactId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      category: selfContextFactCategorySchema,
      content: z.string().trim().min(1).max(500),
      sensitivity: sensitivitySchema,
      expectedUpdatedAt: z.iso.datetime().optional(),
    })
    .strict(),
]);

export const conversationalCaptureDestinationChangeRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    target: conversationalCaptureChangeTargetSchema,
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const conversationalCaptureDestinationUndoRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    target: conversationalCaptureUndoTargetSchema,
  })
  .strict();

export const conversationalSavedItemCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Saved Items"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      kind: z.enum(["Note", "Link", "Open question"]),
      visibility: z.string().min(1),
      reminderSchedule: z.string().min(1).nullable().optional(),
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

export const conversationalActionCaptureConfirmationSchema = z
  .object({
    destination: z.enum(["Actions", "Routines"]),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      title: z.string().min(1),
      dueAt: z.iso.datetime().nullable(),
      cadence: z.string().nullable(),
      scope: z.string().min(1),
      reminderSchedule: z.string().min(1).nullable().optional(),
    }),
    change: z.object({
      kind: z.literal("edit_general_action"),
      generalActionId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_general_action"),
      generalActionId: z.string().min(1),
    }),
  })
  .strict();

export const conversationalFollowupCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Follow-Ups"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      person: z.string().min(1),
      dueAt: z.iso.datetime(),
      scope: z.string().min(1),
      reminderSchedule: z.string().min(1).nullable().optional(),
    }),
    change: z.object({
      kind: z.literal("edit_followup"),
      followupId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_followup"),
      followupId: z.string().min(1),
    }),
  })
  .strict();

export const conversationalPersonCaptureConfirmationSchema = z
  .object({
    destination: z.literal("People"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({ displayName: z.string().min(1), scope: z.string().min(1) }),
    change: z.object({
      kind: z.literal("edit_person"),
      personId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      createdByCapture: z.boolean().default(false),
    }),
  })
  .strict();

export const conversationalMemoryCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Memories"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      person: z.string().min(1),
      authority: z.literal("Approved"),
      scope: z.string().min(1),
    }),
    change: z.object({
      kind: z.literal("edit_memory"),
      memoryId: z.string().min(1),
      sourceRecordId: z.string().min(1),
    }),
    undo: z.object({ kind: z.literal("archive_memory"), memoryId: z.string().min(1) }),
  })
  .strict();

export const conversationalAssetReviewCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Review"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      record: z.enum(["Asset", "Memory"]),
      name: z.string().min(1),
      authority: z.literal("Needs review"),
      scope: z.string().min(1),
    }),
    change: z.union([
      z.object({
        kind: z.literal("edit_asset_review"),
        groupId: z.string().min(1),
        sourceRecordId: z.string().min(1),
      }),
      z.object({
        kind: z.literal("edit_memory"),
        memoryId: z.string().min(1),
        sourceRecordId: z.string().min(1),
      }),
    ]),
    undo: z.union([
      z.object({ kind: z.literal("dismiss_asset_review"), groupId: z.string().min(1) }),
      z.object({ kind: z.literal("archive_memory"), memoryId: z.string().min(1) }),
    ]),
  })
  .strict();

export const conversationalContextFactCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Self Context"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      category: selfContextFactCategorySchema,
      content: z.string().trim().min(1).max(500),
      sensitivity: sensitivitySchema,
      scope: z.string().min(1),
    }),
    change: z.object({
      kind: z.literal("edit_context_fact"),
      contextFactId: z.string().min(1),
      sourceRecordId: z.string().min(1),
      expectedUpdatedAt: z.iso.datetime().optional(),
    }),
    undo: z.union([
      z
        .object({
          kind: z.literal("archive_context_fact"),
          contextFactId: z.string().min(1),
          sourceRecordId: z.string().min(1),
          expectedUpdatedAt: z.iso.datetime().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("edit_context_fact"),
          contextFactId: z.string().min(1),
          sourceRecordId: z.string().min(1),
          category: selfContextFactCategorySchema,
          content: z.string().trim().min(1).max(500),
          sensitivity: sensitivitySchema,
          expectedUpdatedAt: z.iso.datetime().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const conversationalCaptureOutcomeConfirmationSchema = z.discriminatedUnion("destination", [
  conversationalSavedItemCaptureConfirmationSchema,
  conversationalActionCaptureConfirmationSchema,
  conversationalFollowupCaptureConfirmationSchema,
  conversationalPersonCaptureConfirmationSchema,
  conversationalMemoryCaptureConfirmationSchema,
  conversationalAssetReviewCaptureConfirmationSchema,
  conversationalContextFactCaptureConfirmationSchema,
]);

export const conversationalGroupedCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Grouped"),
    groundedBySourceRecordId: z.string().min(1),
    outcomes: z.array(conversationalCaptureOutcomeConfirmationSchema).min(2).max(8),
  })
  .strict();

export const conversationalCaptureConfirmationSchema = z.union([
  conversationalCaptureOutcomeConfirmationSchema,
  conversationalGroupedCaptureConfirmationSchema,
]);

export const conversationalCaptureClarificationSchema = z
  .object({
    field: z.enum(["timing", "cadence", "person"]),
    question: z.string().min(1),
    sourceRecordId: z.string().min(1),
    actions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("add_person"),
              label: z.string().min(1),
              displayName: z.string().min(1),
              unresolvedMentionId: z.string().min(1).optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("link_person"),
              label: z.literal("Link someone else"),
            })
            .strict(),
        ]),
      )
      .max(2)
      .optional(),
  })
  .strict();

export type ConversationalCaptureRequest = z.infer<typeof conversationalCaptureRequestSchema>;
export type ConversationalCaptureVisibility = z.infer<typeof conversationalCaptureVisibilitySchema>;
export type ConversationalCaptureInferredSuggestion = z.infer<
  typeof conversationalCaptureInferredSuggestionSchema
>;
export type ConversationalCaptureChangeRequest = z.infer<
  typeof conversationalCaptureChangeRequestSchema
>;
export type ConversationalCaptureUndoRequest = z.infer<
  typeof conversationalCaptureUndoRequestSchema
>;
export type ConversationalCaptureConfirmation = z.infer<
  typeof conversationalCaptureConfirmationSchema
>;
export type ConversationalCaptureOutcomeConfirmation = z.infer<
  typeof conversationalCaptureOutcomeConfirmationSchema
>;
export type ConversationalCaptureClarification = z.infer<
  typeof conversationalCaptureClarificationSchema
>;
export type ConversationalCaptureChangeTarget = z.infer<
  typeof conversationalCaptureChangeTargetSchema
>;
export type ConversationalCaptureUndoTarget = z.infer<typeof conversationalCaptureUndoTargetSchema>;
