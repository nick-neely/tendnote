"use server";

import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import {
  archiveSavedItem,
  createSavedItem,
  deleteUniqueSavedItemSource,
  editSavedItem,
  getSavedItem,
  getSavedItemSourceDeletionImpact,
  listSavedItems,
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
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidateActionMutation } from "@/lib/cache/action-mutation-scopes";
import { assetMutationScopes, updateAssetMutationScopes } from "@/lib/cache/asset-mutation-scopes";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
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
  callerUserId: string,
  run: () => Promise<Parameters<typeof toSavedItemView>[0]>,
): Promise<SavedItemMutationResult> {
  try {
    const item = await run();
    updateAssetMutationScopes(
      assetMutationScopes.forSavedItem({
        callerUserId,
        savedItemId: item.id,
        householdId: item.householdId,
        sharedWithUserIds: item.sharedWithUserIds,
      }),
    );
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
  return runMutation(ownerUserId, async () => {
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
  return runMutation(actorUserId, async () => {
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
  return runMutation(actorUserId, () =>
    archiveSavedItem({ actorUserId, savedItemId: savedItemIdSchema.parse(input).savedItemId }),
  );
}

export async function reopenSavedItemAction(input: { savedItemId: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(actorUserId, () =>
    reopenSavedItem({ actorUserId, savedItemId: savedItemIdSchema.parse(input).savedItemId }),
  );
}

export async function resolveSavedItemAction(input: { savedItemId: string; reason: string }) {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runMutation(actorUserId, () =>
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
  const result = await runMutation(actorUserId, () => {
    const { savedItemId } = savedItemIdSchema.parse(input);
    return promoteSavedItemToGeneralAction({
      actorUserId,
      savedItemId,
      authority: "explicit",
      idempotencyKey: `saved-item:${savedItemId}:general-action`,
      title: input.title,
    });
  });
  if (result.ok) {
    for (const outcome of result.view.outcomes) {
      if (outcome.destinationKind === "general_action") {
        invalidateActionMutation({
          ownerUserId: actorUserId,
          actionId: outcome.destinationRecordId,
        });
      }
    }
  }
  return result;
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
  const item = await getSavedItem({ callerUserId: actorUserId, savedItemId });
  const deleted = await deleteUniqueSavedItemSource({ actorUserId, savedItemId });
  updateAssetMutationScopes(
    assetMutationScopes.forSavedItem({
      callerUserId: actorUserId,
      savedItemId,
      householdId: item?.householdId,
      sharedWithUserIds: item?.sharedWithUserIds,
    }),
  );
  return deleted;
}

/** Archived Saved Items are quiet secondary history, read only when the owner opens it. */
export async function getArchivedSavedItemViewsAction() {
  const callerUserId = await requireAdmittedOwnerForAction();
  const [items, schedules] = await Promise.all([
    listSavedItems({ callerUserId, includeArchived: true }),
    listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
  ]);
  const scheduleByItemId = new Map(
    schedules
      .filter((schedule) => schedule.recordKind === "saved_item")
      .map((schedule) => [schedule.recordId, schedule]),
  );
  const now = new Date();
  return items
    .filter((item) => item.status === "archived")
    .map((item) => {
      const schedule = scheduleByItemId.get(item.id);
      return toSavedItemView(
        item,
        now,
        schedule ? toReminderScheduleView(schedule, "instant") : null,
      );
    });
}
