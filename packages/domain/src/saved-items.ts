import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

export const savedItemKindSchema = z.enum(["note", "link", "open_question"]);
export const savedItemStatusSchema = z.enum(["active", "archived"]);
export const savedItemTimeSemanticsSchema = z.enum(["date_only", "instant"]);
export const savedItemEventKindSchema = z.enum([
  "created",
  "edited",
  "archived",
  "reopened",
  "resolved",
  "promoted",
  "visibility_changed",
  "mutation_rejected",
]);
export const savedItemDestinationKindSchema = z.enum(["general_action"]);
export const savedItemResolutionReasonSchema = z.string().trim().min(1).max(2_000);
export const savedItemSearchQuerySchema = z.string().trim().min(1).max(400);

const savedItemContentFields = z.object({
  kind: savedItemKindSchema,
  title: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(20_000).nullable().default(null),
  url: z.url().max(2_000).nullable().default(null),
});

function validateKindFields(
  value: z.infer<typeof savedItemContentFields>,
  context: z.core.$RefinementCtx,
) {
  if (value.kind === "link" && !value.url) {
    context.addIssue({
      code: "custom",
      path: ["url"],
      message: "A link Saved Item requires a valid URL.",
    });
  }
  if (value.kind !== "link" && value.url) {
    context.addIssue({
      code: "custom",
      path: ["url"],
      message: "Only a link Saved Item may store a URL.",
    });
  }
}

export const savedItemSchema = savedItemContentFields
  .extend({
    id: z.string(),
    ownerUserId: z.string().min(1),
    status: savedItemStatusSchema.default("active"),
    bringBackAt: z.date().nullable().default(null),
    bringBackTimeSemantics: savedItemTimeSemanticsSchema.default("date_only"),
    sourceRecordId: z.string().min(1),
    scope: privacyScopeSchema.default("private"),
    householdId: z.string().nullable().default(null),
    resolvedAt: z.date().nullable().default(null),
    resolutionReason: savedItemResolutionReasonSchema.nullable().default(null),
    createdByUserId: z.string().nullable().default(null),
    lastActorUserId: z.string().nullable().default(null),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine(validateKindFields);

export const createSavedItemSchema = savedItemContentFields
  .extend({
    id: z.string().optional(),
    ownerUserId: z.string().min(1),
    status: savedItemStatusSchema.default("active"),
    bringBackAt: z.date().nullable().default(null),
    bringBackTimeSemantics: savedItemTimeSemanticsSchema.default("date_only"),
    sourceRecordId: z.string().min(1),
    scope: privacyScopeSchema.default("private"),
    householdId: z.string().nullable().default(null),
    resolvedAt: z.date().nullable().default(null),
    resolutionReason: savedItemResolutionReasonSchema.nullable().default(null),
    createdByUserId: z.string().nullable().default(null),
    lastActorUserId: z.string().nullable().default(null),
  })
  .superRefine(validateKindFields);

export const savedItemUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    content: z.string().trim().min(1).max(20_000).nullable().optional(),
    url: z.url().max(2_000).nullable().optional(),
    status: savedItemStatusSchema.optional(),
    bringBackAt: z.date().nullable().optional(),
    bringBackTimeSemantics: savedItemTimeSemanticsSchema.optional(),
    scope: privacyScopeSchema.optional(),
    householdId: z.string().nullable().optional(),
    resolvedAt: z.date().nullable().optional(),
    resolutionReason: savedItemResolutionReasonSchema.nullable().optional(),
    lastActorUserId: z.string().nullable().optional(),
  })
  .strict();

export const savedItemEditSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    content: z.string().trim().min(1).max(20_000).nullable().optional(),
    url: z.url().max(2_000).nullable().optional(),
    bringBackAt: z.date().nullable().optional(),
    bringBackTimeSemantics: savedItemTimeSemanticsSchema.optional(),
  })
  .strict();

export const savedItemEventSchema = z.object({
  id: z.string(),
  savedItemId: z.string(),
  ownerUserId: z.string(),
  kind: savedItemEventKindSchema,
  actorUserId: z.string().nullable(),
  detailJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
});

export const savedItemOutcomeSchema = z.object({
  id: z.string(),
  savedItemId: z.string(),
  destinationKind: savedItemDestinationKindSchema,
  destinationRecordId: z.string(),
  idempotencyKey: z.string().min(1),
  createdAt: z.date(),
});

export class SavedItemValidationError extends Error {
  override name = "SavedItemValidationError";
}

export type SavedItemLifecycleAction = "archive" | "reopen" | "resolve";

export function resolveSavedItemTransition(
  status: SavedItemStatus,
  action: SavedItemLifecycleAction,
  context: { kind?: SavedItemKind; resolved?: boolean } = {},
): SavedItemStatus {
  if (action === "archive" && status === "active") return "archived";
  if (action === "resolve" && status === "active") {
    if (context.kind !== "open_question") {
      throw new SavedItemValidationError("Only an open question can be resolved.");
    }
    return "archived";
  }
  if (action === "reopen" && status === "archived") {
    if (context.resolved) {
      throw new SavedItemValidationError("A resolved Saved Item cannot be reopened.");
    }
    return "active";
  }
  throw new SavedItemValidationError(`Cannot ${action} a Saved Item that is ${status}.`);
}

export function assertSavedItemEditable(item: Pick<SavedItem, "status">) {
  if (item.status !== "active") {
    throw new SavedItemValidationError("Archived Saved Items are read-only until reopened.");
  }
}

export function isEmptySavedItemEdit(edit: SavedItemEdit): boolean {
  return (
    edit.title === undefined &&
    edit.content === undefined &&
    edit.url === undefined &&
    edit.bringBackAt === undefined
  );
}

export type SavedItem = z.infer<typeof savedItemSchema>;
export type SavedItemKind = z.infer<typeof savedItemKindSchema>;
export type SavedItemStatus = z.infer<typeof savedItemStatusSchema>;
export type SavedItemEventKind = z.infer<typeof savedItemEventKindSchema>;
export type SavedItemEvent = z.infer<typeof savedItemEventSchema>;
export type SavedItemOutcome = z.infer<typeof savedItemOutcomeSchema>;
export type SavedItemDestinationKind = z.infer<typeof savedItemDestinationKindSchema>;
export type CreateSavedItemInput = z.input<typeof createSavedItemSchema>;
export type SavedItemEdit = z.infer<typeof savedItemEditSchema>;
