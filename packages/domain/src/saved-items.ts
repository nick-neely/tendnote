import { z } from "zod";
import type { HouseholdRecordOwnership } from "./household-authorization";
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

/**
 * Which of the two Saved Item ownership forms a record is.
 *
 * The list is pinned to {@link HouseholdRecordOwnership} rather than restated,
 * so a Saved Item can never name an ownership form the Household Authorization
 * Proof does not evaluate (ADR 0219).
 */
export const savedItemOwnershipSchema = z.enum([
  "member_owned",
  "household_native",
] as const satisfies readonly HouseholdRecordOwnership[]);

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

/**
 * The ownership form written into storage, and the rules that keep the two
 * forms from blurring into each other.
 *
 * A `household_native` Saved Item carries **no** `ownerUserId`. That is the
 * point of ADR 0214: `owner_user_id NOT NULL` cannot express a record the
 * workspace owns, and a member id left in that column would be read back as
 * authority by the next adapter that looks — the private branch of the audience
 * rule, the owner-scoped reminder reconciler, the owner-scoped semantic index,
 * and the owner-scoped source-deletion path all key off it. Null makes every one
 * of those paths fail closed for free, and authority comes from the Household
 * Authorization Proof instead. `createdByUserId` still records who wrote it,
 * because attribution is not authority.
 *
 * Household-native also pins scope to `household`: a workspace-owned record that
 * only some members could see would have an audience narrower than its
 * authority, which is not a state the proof can express.
 */
function validateOwnershipForm(
  value: {
    ownership: SavedItemOwnership;
    ownerUserId: string | null;
    scope: z.infer<typeof privacyScopeSchema>;
    householdId: string | null;
    createdByUserId: string | null;
  },
  context: z.core.$RefinementCtx,
) {
  if (value.ownership === "member_owned") {
    if (!value.ownerUserId) {
      context.addIssue({
        code: "custom",
        path: ["ownerUserId"],
        message: "A member-owned Saved Item needs an owner.",
      });
    }
    return;
  }
  if (value.ownerUserId !== null) {
    context.addIssue({
      code: "custom",
      path: ["ownerUserId"],
      message: "A household-native Saved Item belongs to the household, not to a member.",
    });
  }
  if (value.scope !== "household") {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "A household-native Saved Item is visible to the whole household.",
    });
  }
  if (!value.householdId) {
    context.addIssue({
      code: "custom",
      path: ["householdId"],
      message: "A household-native Saved Item needs a household.",
    });
  }
  if (!value.createdByUserId) {
    context.addIssue({
      code: "custom",
      path: ["createdByUserId"],
      message: "A household-native Saved Item records who created it.",
    });
  }
}

const savedItemStoredFields = {
  ownerUserId: z.string().min(1).nullable().default(null),
  ownership: savedItemOwnershipSchema.default("member_owned"),
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
  /**
   * The optimistic-concurrency counter, incremented by every write.
   *
   * A counter rather than `updatedAt`, because two members saving inside the
   * same millisecond would both match an `updated_at` guard and the second would
   * silently win — exactly the last-write-wins this domain refuses.
   */
  version: z.number().int().min(1).default(1),
};

export const savedItemSchema = savedItemContentFields
  .extend({
    id: z.string(),
    ...savedItemStoredFields,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine(validateKindFields)
  .superRefine(validateOwnershipForm);

export const createSavedItemSchema = savedItemContentFields
  .extend({
    id: z.string().optional(),
    ...savedItemStoredFields,
  })
  .superRefine(validateKindFields)
  .superRefine(validateOwnershipForm);

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
  /** Null on a household-native item's trail; `actorUserId` still names who acted. */
  ownerUserId: z.string().nullable(),
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

/**
 * What a member who has fallen behind is shown instead of their write.
 *
 * It carries the current value and the last actor because the surface has to
 * put the two side by side: the draft is kept, the current text is shown, and
 * the member decides. Tendnote never merges the two and never lets the later
 * save quietly win (see `docs/phase-8/household-saved-items.md`).
 *
 * The wording is factual rather than corrective — nobody did anything wrong by
 * writing at the same time as someone else.
 */
export class SavedItemConflictError extends SavedItemValidationError {
  override name = "SavedItemConflictError";

  constructor(readonly current: SavedItemConflict) {
    super("Someone else changed this while you were writing. Your draft is kept below.");
  }
}

/** The authoritative value a stale writer is reconciled against. */
export type SavedItemConflict = {
  savedItemId: string;
  version: number;
  title: string;
  content: string | null;
  url: string | null;
  bringBackAt: Date | null;
  status: SavedItemStatus;
  lastActorUserId: string | null;
  updatedAt: Date;
};

export function savedItemConflict(item: SavedItem): SavedItemConflict {
  return {
    savedItemId: item.id,
    version: item.version,
    title: item.title,
    content: item.content,
    url: item.url,
    bringBackAt: item.bringBackAt,
    status: item.status,
    lastActorUserId: item.lastActorUserId,
    updatedAt: item.updatedAt,
  };
}

/**
 * The optimistic-concurrency gate on a household-native write.
 *
 * `expectedVersion` omitted is a deliberate replace — the member has already
 * seen the current value and chose to overwrite it — rather than a caller that
 * forgot to send one. Surfaces send it on the first attempt and omit it only
 * after the member explicitly answers a conflict.
 */
export function assertSavedItemVersion(item: SavedItem, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && expectedVersion !== item.version) {
    throw new SavedItemConflictError(savedItemConflict(item));
  }
}

/**
 * Whether this record's lifecycle and evidence belong to a member at all.
 *
 * The owner-only paths — unique source-evidence deletion above all — ask this
 * rather than testing `ownerUserId`, so the reason they refuse a workspace-owned
 * item reads as the rule it is: archive is a household-native item's removal
 * path, and no single member deletes what the household owns.
 */
export function assertMemberOwnedSavedItem(item: Pick<SavedItem, "ownership">, action: string) {
  if (item.ownership === "household_native") {
    throw new SavedItemValidationError(
      `This belongs to the household, so it can't be ${action}. Archiving keeps it with everyone's history.`,
    );
  }
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
/**
 * A Saved Item reached through an owner-keyed lookup, so its owner is known to
 * be there. The owner-scoped paths deal in this rather than re-checking a
 * nullable column their own query already keyed on.
 */
export type MemberOwnedSavedItem = SavedItem & { ownerUserId: string };
export type SavedItemOwnership = z.infer<typeof savedItemOwnershipSchema>;
export type SavedItemKind = z.infer<typeof savedItemKindSchema>;
export type SavedItemStatus = z.infer<typeof savedItemStatusSchema>;
export type SavedItemEventKind = z.infer<typeof savedItemEventKindSchema>;
export type SavedItemEvent = z.infer<typeof savedItemEventSchema>;
export type SavedItemOutcome = z.infer<typeof savedItemOutcomeSchema>;
export type SavedItemDestinationKind = z.infer<typeof savedItemDestinationKindSchema>;
export type CreateSavedItemInput = z.input<typeof createSavedItemSchema>;
export type SavedItemEdit = z.infer<typeof savedItemEditSchema>;
