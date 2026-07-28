"use server";

import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import {
  archiveSavedItem,
  createSavedItem,
  deleteUniqueSavedItemSource,
  editSavedItem,
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
import { runOwnerAction } from "@/lib/owner-action";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
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
const resolveSchema = z.object({
  savedItemId: z.uuid(),
  reason: savedItemResolutionReasonSchema,
});
const promoteSchema = z.object({ savedItemId: z.uuid(), title: z.string().trim().optional() });
const sourceImpactSchema = z.object({ sourceRecordId: z.uuid() });

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

export async function createSavedItemAction(input: {
  kind: string;
  title: string;
  content?: string;
  url?: string;
  bringBackAt?: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<SavedItemMutationResult> {
  return runOwnerAction({
    schema: createSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) =>
      createSavedItem({
        ownerUserId,
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content || null,
        url: parsed.url || null,
        bringBackAt: parseOptionalDate(parsed.bringBackAt) ?? null,
        bringBackTimeSemantics: parsed.bringBackAt ? "instant" : "date_only",
        originalText: originalText(parsed),
        scope: resolvedScope?.scope,
        householdId: resolvedScope?.householdId,
        selectedUserIds: parsed.selectedUserIds,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toSavedItemView(outcome.result, new Date(), null, ownerUserId),
  });
}

export async function editSavedItemAction(input: {
  savedItemId: string;
  title?: string;
  content?: string | null;
  url?: string | null;
  bringBackAt?: string | null;
}): Promise<SavedItemMutationResult> {
  return runOwnerAction({
    schema: editSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editSavedItem({
        actorUserId: ownerUserId,
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
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toSavedItemView(outcome.result, new Date(), null, ownerUserId),
  });
}

export async function archiveSavedItemAction(input: { savedItemId: string }) {
  return runSavedItemIdMutation(input, archiveSavedItem);
}

export async function reopenSavedItemAction(input: { savedItemId: string }) {
  return runSavedItemIdMutation(input, reopenSavedItem);
}

export async function resolveSavedItemAction(input: { savedItemId: string; reason: string }) {
  return runOwnerAction({
    schema: resolveSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      resolveSavedItem({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        reason: parsed.reason,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toSavedItemView(outcome.result, new Date(), null, ownerUserId),
  });
}

function runSavedItemIdMutation(input: { savedItemId: string }, mutate: typeof archiveSavedItem) {
  return runOwnerAction({
    schema: savedItemIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      mutate({ actorUserId: ownerUserId, savedItemId: parsed.savedItemId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toSavedItemView(outcome.result, new Date(), null, ownerUserId),
  });
}

export async function promoteSavedItemToGeneralActionAction(input: {
  savedItemId: string;
  title?: string;
}) {
  return runOwnerAction({
    schema: promoteSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      promoteSavedItemToGeneralAction({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        authority: "explicit",
        idempotencyKey: `saved-item:${parsed.savedItemId}:general-action`,
        title: parsed.title,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toSavedItemView(outcome.result, new Date(), null, ownerUserId),
  });
}

export async function getSavedItemSourceDeletionImpactAction(input: { sourceRecordId: string }) {
  return runOwnerAction({
    schema: sourceImpactSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      getSavedItemSourceDeletionImpact({
        actorUserId: ownerUserId,
        sourceRecordId: parsed.sourceRecordId,
      }),
    result: (impact) => impact,
  });
}

export async function deleteUniqueSavedItemSourceAction(input: { savedItemId: string }) {
  return runOwnerAction({
    schema: savedItemIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      deleteUniqueSavedItemSource({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
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
        callerUserId,
      );
    });
}
