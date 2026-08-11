import { z } from "zod";
import { assetChildScopeSchema } from "./asset-child-scope";
import { AssetValidationError, assetOwnershipSchema } from "./assets";
import { generalActionRecurrenceUnitSchema, MAX_RECURRENCE_INTERVAL } from "./general-actions";

/**
 * An Asset Memory's lifecycle (#198). A memory is born `suggested` when inferred
 * (review-gated: it never silently becomes truth) and `active` when accepted or
 * explicitly created; `dismissed` is the resolved husk of a rejected suggestion.
 * Promotion flips the status in place on one row — the suggested and durable
 * paths never fork, mirroring Suggested General Actions (ADRs 0151, 0152).
 */
export const assetMemoryStatusSchema = z.enum(["suggested", "active", "dismissed"]);
export type AssetMemoryStatus = z.infer<typeof assetMemoryStatusSchema>;

/**
 * The typed value an Asset Memory can carry alongside (or instead of) freeform
 * notes: exact text (model numbers, filter sizes), a calendar date (purchase,
 * warranty, renewal), a recurring interval (a maintenance or replacement cadence),
 * or a lightweight amount for receipts/renewals — recall metadata only, never
 * budgets or financial reporting (#196).
 *
 * `date` and `interval` are the two *timed* facts, and the only ones that can
 * propose a Suggested General Action (#203): a date proposes a one-time reminder,
 * an interval proposes a Routine. Everything else is recall, not a reminder.
 */
export const assetMemoryValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(500) }).strict(),
  // A plain calendar date ("2026-03-14") — asset facts are day-precise, never timestamps.
  z.object({ type: z.literal("date"), date: z.iso.date() }).strict(),
  // A cadence ("every 6 months"), borrowing the General Action recurrence unit and
  // bounds outright so an interval memory maps 1:1 onto a Routine's cadence — the
  // proposal path never has to translate between two rhythm vocabularies (#203).
  z
    .object({
      type: z.literal("interval"),
      interval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL),
      unit: generalActionRecurrenceUnitSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("amount"),
      amount: z.number().finite().nonnegative(),
      currency: z
        .string()
        .trim()
        .length(3)
        .transform((code) => code.toUpperCase())
        .default("USD"),
    })
    .strict(),
]);
export type AssetMemoryValue = z.infer<typeof assetMemoryValueSchema>;

/**
 * Visibility a memory can hold in this slice: the shared Asset child scope
 * (private or household) under the child-scope ceiling in `asset-child-scope.ts`,
 * which memories and evidence apply identically (#198, #200).
 */
export const assetMemoryScopeSchema = assetChildScopeSchema;
export type AssetMemoryScope = z.infer<typeof assetMemoryScopeSchema>;

/** A memory needs substance: a typed value, freeform notes, or both. */
function hasMemoryContent(record: { value: AssetMemoryValue | null; notes: string | null }) {
  return record.value !== null || record.notes !== null;
}

/**
 * An Asset Memory: a durable, reviewed piece of personal context anchored to one
 * Asset (#196, #198) — `label` names the fact ("Filter size"), `value` carries the
 * typed exact fact, `notes` the freeform context; at least one of the two must be
 * present. Visibility is per-record (a household Asset can hold a private memory),
 * never broader than the Asset's own scope — the child-scope ceiling. Provenance:
 * the grounding source record, who created it, and who last acted on it.
 */
const assetMemoryBaseSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  /** A storage key on a household-native memory, never authority (ADR 0214). */
  ownerUserId: z.string(),
  status: assetMemoryStatusSchema.default("suggested"),
  label: z.string().trim().min(1).max(120),
  value: assetMemoryValueSchema.nullable().default(null),
  notes: z.string().trim().min(1).max(2000).nullable().default(null),
  scope: assetMemoryScopeSchema.default("private"),
  /**
   * Whose memory this is, independent of its parent Asset's ownership form. A
   * household-native Asset can hold one member's private note, and a
   * jointly-maintained detail on it is the workspace's (#386).
   */
  ownership: assetOwnershipSchema.default("member_owned"),
  householdId: z.string().nullable().default(null),
  /** Optimistic-concurrency fence for a jointly-maintained detail. See `assetSchema`. */
  revision: z.number().int().nonnegative().default(0),
  // Evidence/source grounding for the memory, where it was inferred from.
  sourceRecordId: z.string().nullable().default(null),
  // The Asset Review Group a suggested memory arrived in, for grouped review.
  reviewGroupId: z.string().nullable().default(null),
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const assetMemorySchema = assetMemoryBaseSchema.refine(hasMemoryContent, {
  message: "An asset memory needs a value or notes.",
});

export const createAssetMemorySchema = assetMemoryBaseSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .refine(hasMemoryContent, { message: "An asset memory needs a value or notes." });

export type AssetMemory = z.infer<typeof assetMemorySchema>;
export type CreateAssetMemoryInput = z.input<typeof createAssetMemorySchema>;

/**
 * Validates a bounded update patch for a persisted memory. Defaults-free on
 * purpose — an absent key stays absent, so a status-only patch can never reset
 * scope, content, or anchoring (the same contract as `assetUpdateSchema`).
 */
export const assetMemoryUpdateSchema = z
  .object({
    assetId: z.string(),
    status: assetMemoryStatusSchema,
    label: z.string().trim().min(1).max(120),
    value: assetMemoryValueSchema.nullable(),
    notes: z.string().trim().min(1).max(2000).nullable(),
    scope: assetMemoryScopeSchema,
    householdId: z.string().nullable(),
    lastActorUserId: z.string().nullable(),
  })
  .partial();
// `ownership` is deliberately absent: a detail is created as one form or the
// other and never converted in place, so no patch can quietly hand a member's
// private note to the workspace. `revision` is the store's, not a caller's.

export type AssetMemoryUpdate = z.infer<typeof assetMemoryUpdateSchema>;

/**
 * Edit payload for a memory's reviewable content — the inline fix a reviewer makes
 * before accepting (#198). `undefined` leaves a field unchanged; explicit `null`
 * clears the value or notes (never both — a memory keeps substance).
 */
export const assetMemoryEditSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    value: assetMemoryValueSchema.nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict();

export type AssetMemoryEdit = z.infer<typeof assetMemoryEditSchema>;

export function isEmptyAssetMemoryEdit(edit: AssetMemoryEdit): boolean {
  return edit.label === undefined && edit.value === undefined && edit.notes === undefined;
}

/**
 * Resolves a content edit against the memory's current content into a bounded
 * patch, rejecting a no-op and any edit that would strip the memory of both its
 * value and notes. One validation path for edit-in-place and edit-before-accept,
 * so the two can never drift.
 */
export function resolveAssetMemoryContentPatch(
  current: { label: string; value: AssetMemoryValue | null; notes: string | null },
  edit: AssetMemoryEdit,
): Pick<AssetMemoryUpdate, "label" | "value" | "notes"> {
  const parsed = assetMemoryEditSchema.parse(edit);
  if (isEmptyAssetMemoryEdit(parsed)) {
    throw new AssetValidationError("An edit must change the label, value, or notes.");
  }

  const next = {
    value: parsed.value !== undefined ? parsed.value : current.value,
    notes: parsed.notes !== undefined ? parsed.notes : current.notes,
  };
  if (!hasMemoryContent(next)) {
    throw new AssetValidationError("A memory needs a value or notes. Clear one, not both.");
  }

  return {
    ...(parsed.label !== undefined ? { label: parsed.label } : {}),
    ...(parsed.value !== undefined ? { value: parsed.value } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
  };
}

// The child-scope ceiling, default, and link-clamp rules moved to
// `asset-child-scope.ts` (#200) — one rule set for every Asset child record, so
// memories and evidence can never drift apart.
