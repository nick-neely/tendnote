import { z } from "zod";
import { AssetValidationError } from "./assets";
import type { PrivacyScope } from "./privacy";

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
 * warranty, renewal), or a lightweight amount for receipts/renewals — recall
 * metadata only, never budgets or financial reporting (#196).
 */
export const assetMemoryValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(500) }).strict(),
  // A plain calendar date ("2026-03-14") — asset facts are day-precise, never timestamps.
  z.object({ type: z.literal("date"), date: z.iso.date() }).strict(),
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
 * Visibility a memory can hold in this slice: private or household. A
 * selected-shared memory audience is deferred — additive later, never assumed —
 * so no memory share rows exist yet (#198).
 */
export const assetMemoryScopeSchema = z.enum(["private", "household"]);
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
  ownerUserId: z.string(),
  status: assetMemoryStatusSchema.default("suggested"),
  label: z.string().trim().min(1).max(120),
  value: assetMemoryValueSchema.nullable().default(null),
  notes: z.string().trim().min(1).max(2000).nullable().default(null),
  scope: assetMemoryScopeSchema.default("private"),
  householdId: z.string().nullable().default(null),
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
    throw new AssetValidationError("A memory needs a value or notes — clear one, not both.");
  }

  return {
    ...(parsed.label !== undefined ? { label: parsed.label } : {}),
    ...(parsed.value !== undefined ? { value: parsed.value } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
  };
}

// How wide each scope reaches, for the child-scope ceiling: a household record
// reaches every active member, a shared one a selected few, a private one only
// its owner. Children may sit at or below their Asset's rank, never above.
const SCOPE_REACH: Record<PrivacyScope, number> = { private: 0, shared: 1, household: 2 };

/**
 * The child-scope ceiling (#196): an Asset's scope is the broadest visibility any
 * child record may hold. A private memory under a household Asset is fine; a
 * household memory under a private (or selected-shared) Asset would widen the
 * audience and is rejected fail-closed.
 */
export function requireMemoryScopeWithinAsset(input: {
  memoryScope: AssetMemoryScope;
  assetScope: PrivacyScope;
}): void {
  if (SCOPE_REACH[input.memoryScope] > SCOPE_REACH[input.assetScope]) {
    throw new AssetValidationError(
      "A detail can't be more visible than its asset — narrow it or widen the asset first.",
    );
  }
}

/**
 * The visibility a new memory defaults to under an Asset: the Asset's own scope
 * where this slice supports it (household), otherwise private. Fail-closed — a
 * selected-shared Asset defaults its details to private rather than guessing an
 * audience this slice cannot represent.
 */
export function defaultMemoryScopeForAsset(assetScope: PrivacyScope): AssetMemoryScope {
  return assetScope === "household" ? "household" : "private";
}

/**
 * Re-resolves a memory's visibility when duplicate review re-anchors it to an
 * existing Asset (#198): the memory keeps its scope where the target allows it and
 * is clamped to private otherwise, adopting the target's household. Deterministic
 * and fail-closed — linking never widens who can see a detail.
 */
export function resolveLinkedMemoryVisibility(input: {
  memoryScope: AssetMemoryScope;
  target: { scope: PrivacyScope; householdId: string | null };
}): { scope: AssetMemoryScope; householdId: string | null } {
  if (input.memoryScope === "household" && input.target.scope === "household") {
    return { scope: "household", householdId: input.target.householdId };
  }
  return { scope: "private", householdId: null };
}
