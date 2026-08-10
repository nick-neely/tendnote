"use server";

import {
  createActiveAssetMemory,
  editAssetMemory,
  restoreAssetMemory,
  setAsideAssetMemory,
} from "@tendnote/db/queries/assets";
import { z } from "zod";
import { type AssetMemoryMutationResult, toAssetMemoryView } from "@/lib/asset-memory-view";
import { runOwnerAction } from "@/lib/owner-action";

const labelSchema = z.string().trim().min(1, "Name the detail.").max(120);
const valueSchema = z.string().trim().max(500);
const notesSchema = z.string().trim().max(2000);

const createSchema = z.object({
  assetId: z.uuid(),
  label: labelSchema,
  value: valueSchema.optional(),
  notes: notesSchema.optional(),
  /**
   * Whether this detail is the household's rather than the writer's. Only
   * offered under a household-native Asset; the seam refuses it anywhere else
   * (ADR 0214).
   */
  household: z.boolean().default(false),
});

const editSchema = z.object({
  memoryId: z.uuid(),
  label: labelSchema.optional(),
  value: valueSchema.optional(),
  notes: notesSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const memoryIdSchema = z.object({ memoryId: z.uuid() });

/**
 * Maps the two content fields onto the domain edit shape.
 *
 * An emptied box is a clear, not an absence: the form always sends both fields,
 * so `""` is the member deliberately removing what was there and travels as an
 * explicit `null`. A field that never arrives leaves the stored value alone. The
 * domain still refuses an edit that would strip a detail of both at once, so
 * "clear one, not both" stays its rule rather than this one.
 */
function contentFrom(input: { value?: string; notes?: string }) {
  return {
    ...(input.value === undefined
      ? {}
      : { value: input.value ? { type: "text" as const, text: input.value } : null }),
    ...(input.notes === undefined ? {} : { notes: input.notes || null }),
  };
}

/**
 * Keeps a detail the member typed themselves — the direct path that never needs
 * review, because explicit intent is not an inference (#196).
 */
export async function createAssetMemoryAction(input: {
  assetId: string;
  label: string;
  value?: string;
  notes?: string;
  household?: boolean;
}): Promise<AssetMemoryMutationResult> {
  return runOwnerAction({
    schema: createSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createActiveAssetMemory({
        ownerUserId,
        assetId: parsed.assetId,
        label: parsed.label,
        ...contentFrom(parsed),
        ...(parsed.household
          ? // A household detail is whole-household-visible by definition, so no
            // scope travels with it — the seam sets it.
            { ownership: "household_native" as const }
          : {}),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetMemoryView(outcome.result, { callerUserId }),
  });
}

/**
 * Corrects a detail that is already kept. Authority and freshness are both
 * decided downstream: the owner of a member-owned detail or any active member of
 * the household's own, and a stale `expectedRevision` preserves the draft.
 */
export async function editAssetMemoryAction(input: {
  memoryId: string;
  label?: string;
  value?: string;
  notes?: string;
  expectedRevision?: number;
}): Promise<AssetMemoryMutationResult> {
  return runOwnerAction({
    schema: editSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editAssetMemory({
        actorUserId: ownerUserId,
        memoryId: parsed.memoryId,
        edit: {
          ...(parsed.label !== undefined ? { label: parsed.label } : {}),
          ...contentFrom(parsed),
        },
        expectedRevision: parsed.expectedRevision,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetMemoryView(outcome.result, { callerUserId }),
  });
}

/**
 * Sets aside a detail that is no longer true. Nothing is deleted, and
 * {@link restoreAssetMemoryAction} is the inverse the surface's undo spends —
 * the copy promises reversibility, so the reversal has to exist.
 */
export async function setAsideAssetMemoryAction(input: {
  memoryId: string;
}): Promise<AssetMemoryMutationResult> {
  return runOwnerAction({
    schema: memoryIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setAsideAssetMemory({ actorUserId: ownerUserId, memoryId: parsed.memoryId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetMemoryView(outcome.result, { callerUserId }),
  });
}

/** Brings a set-aside detail back. */
export async function restoreAssetMemoryAction(input: {
  memoryId: string;
}): Promise<AssetMemoryMutationResult> {
  return runOwnerAction({
    schema: memoryIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreAssetMemory({ actorUserId: ownerUserId, memoryId: parsed.memoryId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetMemoryView(outcome.result, { callerUserId }),
  });
}
