"use server";

import {
  archiveSavedItem,
  createSavedItem,
  deleteUniqueSavedItemSource,
  editSavedItem,
  getSavedItemSourceDeletionImpact,
  promoteSavedItemToGeneralAction,
  reopenSavedItem,
  resolveSavedItem,
} from "@tendnote/db/queries/saved-items";
import {
  SavedItemValidationError,
  savedItemKindSchema,
  savedItemResolutionReasonSchema,
} from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { resolveScopeForCaller } from "@/lib/resolve-scope-for-caller";
import { type SavedItemMutationResult, toSavedItemView } from "@/lib/saved-item-view";

const savedItemIdSchema = z.object({ savedItemId: z.uuid() });
const selectedUserIdsSchema = z.array(z.string().min(1)).max(50).optional();
const createSchema = z.object({
  kind: savedItemKindSchema,
  title: z.string().trim().min(1, "Give this Saved Item a title.").max(240),
  content: z.string().trim().max(20_000).optional(),
  url: z.string().trim().max(2_000).optional(),
  bringBackAt: z.string().trim().optional(),
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: selectedUserIdsSchema,
});
const editSchema = z.object({
  savedItemId: z.uuid(),
  title: z.string().trim().min(1).max(240).optional(),
  content: z.string().trim().max(20_000).nullable().optional(),
  url: z.string().trim().max(2_000).nullable().optional(),
  bringBackAt: z.string().trim().nullable().optional(),
});

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new SavedItemValidationError("Choose a valid bring-back time.");
  return parsed;
}

function originalText(input: z.infer<typeof createSchema>): string {
  if (input.kind === "link") return [input.title, input.url].filter(Boolean).join(" · ");
  return input.content || input.title;
}

function userSafeError(error: unknown): string | null {
  if (error instanceof SavedItemValidationError) return error.message;
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? "Check the Saved Item details.";
  return null;
}

async function runMutation(
  run: () => Promise<Parameters<typeof toSavedItemView>[0]>,
): Promise<SavedItemMutationResult> {
  try {
    const item = await run();
    revalidatePath("/saved-items");
    return { ok: true, view: toSavedItemView(item) };
  } catch (error) {
    const message = userSafeError(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

export async function createSavedItemAction(input: {
  kind: string;
  title: string;
  content?: string;
  url?: string;
  bringBackAt?: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<SavedItemMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(async () => {
    const parsed = createSchema.parse(input);
    const { scope, householdId } = await resolveScopeForCaller(
      ownerUserId,
      parsed.visibilityChoice,
    );
    return createSavedItem({
      ownerUserId,
      kind: parsed.kind,
      title: parsed.title,
      content: parsed.content || null,
      url: parsed.url || null,
      bringBackAt: parseOptionalDate(parsed.bringBackAt) ?? null,
      bringBackTimeSemantics: parsed.bringBackAt ? "instant" : "date_only",
      originalText: originalText(parsed),
      scope,
      householdId,
      selectedUserIds: parsed.selectedUserIds,
    });
  });
}

export async function editSavedItemAction(input: {
  savedItemId: string;
  title?: string;
  content?: string | null;
  url?: string | null;
  bringBackAt?: string | null;
}): Promise<SavedItemMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(async () => {
    const parsed = editSchema.parse(input);
    return editSavedItem({
      actorUserId,
      savedItemId: parsed.savedItemId,
      edit: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.content !== undefined ? { content: parsed.content || null } : {}),
        ...(parsed.url !== undefined ? { url: parsed.url || null } : {}),
        ...(parsed.bringBackAt !== undefined
          ? {
              bringBackAt: parseOptionalDate(parsed.bringBackAt) ?? null,
              bringBackTimeSemantics: parsed.bringBackAt
                ? ("instant" as const)
                : ("date_only" as const),
            }
          : {}),
      },
    });
  });
}

export async function archiveSavedItemAction(input: { savedItemId: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(() =>
    archiveSavedItem({ actorUserId, savedItemId: savedItemIdSchema.parse(input).savedItemId }),
  );
}

export async function reopenSavedItemAction(input: { savedItemId: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(() =>
    reopenSavedItem({ actorUserId, savedItemId: savedItemIdSchema.parse(input).savedItemId }),
  );
}

export async function resolveSavedItemAction(input: { savedItemId: string; reason: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(() =>
    resolveSavedItem({
      actorUserId,
      savedItemId: savedItemIdSchema.parse(input).savedItemId,
      reason: savedItemResolutionReasonSchema.parse(input.reason),
    }),
  );
}

export async function promoteSavedItemToGeneralActionAction(input: {
  savedItemId: string;
  title?: string;
}) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(() => {
    const { savedItemId } = savedItemIdSchema.parse(input);
    return promoteSavedItemToGeneralAction({
      actorUserId,
      savedItemId,
      authority: "explicit",
      idempotencyKey: `saved-item:${savedItemId}:general-action`,
      title: input.title,
    });
  });
}

export async function getSavedItemSourceDeletionImpactAction(input: { sourceRecordId: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return getSavedItemSourceDeletionImpact({
    actorUserId,
    sourceRecordId: z.uuid().parse(input.sourceRecordId),
  });
}

export async function deleteUniqueSavedItemSourceAction(input: { savedItemId: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  const { savedItemId } = savedItemIdSchema.parse(input);
  const deleted = await deleteUniqueSavedItemSource({ actorUserId, savedItemId });
  revalidatePath("/saved-items");
  return deleted;
}
