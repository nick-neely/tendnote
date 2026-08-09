"use server";

import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import {
  archiveHouseholdSavedItem,
  archiveSavedItem,
  createHouseholdSavedItem,
  createSavedItem,
  deleteUniqueSavedItemSource,
  editHouseholdSavedItem,
  editSavedItem,
  getHouseholdSavedItem,
  getSavedItemSourceDeletionImpact,
  listSavedItems,
  promoteHouseholdSavedItem,
  promoteSavedItemToGeneralAction,
  reopenSavedItem,
  resolveHouseholdSavedItem,
  resolveSavedItem,
  restoreHouseholdSavedItem,
  type SavedItemWithContext,
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
import {
  type SavedItemMemberNames,
  type SavedItemMutationResult,
  toSavedItemView,
} from "@/lib/saved-item-view";

const savedItemIdSchema = z.object({ savedItemId: z.uuid() });
const selectedUserIdsSchema = z.array(z.string().min(1)).max(50).optional();
const savedItemContentSchema = {
  kind: savedItemKindSchema,
  title: z.string().trim().min(1, "Give this Saved Item a title.").max(240),
  content: z.string().trim().max(20_000).optional(),
  url: z.string().trim().max(2_000).optional(),
  bringBackAt: z.string().trim().optional(),
};
const createSchema = z.object({
  ...savedItemContentSchema,
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: selectedUserIdsSchema,
});
const createHouseholdSchema = z.object(savedItemContentSchema);
const savedItemEditFieldsSchema = {
  savedItemId: z.uuid(),
  title: z.string().trim().min(1).max(240).optional(),
  content: z.string().trim().max(20_000).nullable().optional(),
  url: z.string().trim().max(2_000).nullable().optional(),
  bringBackAt: z.string().trim().nullable().optional(),
};
const editSchema = z.object(savedItemEditFieldsSchema);
/**
 * `expectedVersion` is optional here for the same reason the domain makes it
 * optional: omitting it is the member's deliberate "replace theirs with mine"
 * after they have seen the current value, not a caller that forgot to send one.
 */
const editHouseholdSchema = z.object({
  ...savedItemEditFieldsSchema,
  expectedVersion: z.number().int().min(1).optional(),
});
const resolveSchema = z.object({
  savedItemId: z.uuid(),
  reason: savedItemResolutionReasonSchema,
});
const promoteSchema = z.object({
  savedItemId: z.uuid(),
  title: z.string().trim().optional(),
  destination: z.enum(["member_owned", "household_native"]).default("member_owned"),
});
const promoteHouseholdSchema = z.object({
  savedItemId: z.uuid(),
  title: z.string().trim().optional(),
});
const sourceImpactSchema = z.object({ sourceRecordId: z.uuid() });

const NO_HOUSEHOLD = "Start a Household Workspace before saving something for the whole household.";

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new SavedItemValidationError("Choose a valid bring-back time.");
  return parsed;
}

function originalText(input: z.infer<typeof createHouseholdSchema>): string {
  if (input.kind === "link") return [input.title, input.url].filter(Boolean).join(" · ");
  return input.content || input.title;
}

function savedItemEdit(input: z.infer<typeof editSchema>) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.content !== undefined ? { content: input.content || null } : {}),
    ...(input.url !== undefined ? { url: input.url || null } : {}),
    ...(input.bringBackAt !== undefined
      ? {
          bringBackAt: parseOptionalDate(input.bringBackAt) ?? null,
          bringBackTimeSemantics: input.bringBackAt ? ("instant" as const) : ("date_only" as const),
        }
      : {}),
  };
}

/**
 * Builds the returned view, reading household member names only when the result
 * is actually going to say one.
 *
 * A private capture is the common case and pays nothing for the household
 * vocabulary; a household-native or someone-else's item pays one bounded read so
 * the row can say "Created by Ana" rather than an id.
 */
async function savedItemView(item: SavedItemWithContext, callerUserId: string) {
  const namesNeeded = item.ownership === "household_native" || item.ownerUserId !== callerUserId;
  const memberNames = namesNeeded ? await householdMemberNames(callerUserId) : undefined;
  return toSavedItemView(item, { callerUserId, memberNames });
}

async function householdMemberNames(callerUserId: string): Promise<SavedItemMemberNames> {
  const members = await listShareableHouseholdMembersForUser({ userId: callerUserId });
  return new Map(members.map((member) => [member.userId, member.name]));
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
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
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
        edit: savedItemEdit(parsed),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
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
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

function runSavedItemIdMutation(input: { savedItemId: string }, mutate: typeof archiveSavedItem) {
  return runOwnerAction({
    schema: savedItemIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      mutate({ actorUserId: ownerUserId, savedItemId: parsed.savedItemId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

/**
 * Promotes the caller's own Saved Item, into their own Action by default.
 *
 * `destination: "household_native"` is the explicit **Make household Action**
 * choice - a new workspace-owned destination the owner confirmed, never an
 * implicit transfer of the Saved Item itself, and with no claim-back path
 * (`docs/phase-8/household-saved-items.md`). The retry key carries the
 * destination so the two choices cannot resume each other's outcome.
 */
export async function promoteSavedItemToGeneralActionAction(input: {
  savedItemId: string;
  title?: string;
  destination?: "member_owned" | "household_native";
}) {
  return runOwnerAction({
    schema: promoteSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      promoteSavedItemToGeneralAction({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        authority: "explicit",
        idempotencyKey:
          parsed.destination === "household_native"
            ? `saved-item:${parsed.savedItemId}:household-general-action`
            : `saved-item:${parsed.savedItemId}:general-action`,
        title: parsed.title,
        destination: parsed.destination,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
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

/*
 * Household-native Saved Items.
 *
 * Their own adapters rather than a flag on the ones above, mirroring the query
 * boundary they call: the member-owned path is keyed by owner and must stay that
 * way, and one adapter that branched would be a place to forget the branch. Each
 * of these passes only `actorUserId` and the record id; the Household
 * Authorization Proof decides the rest (ADR 0214, ADR 0219).
 *
 * Only the edit adapter carries `expectedVersion`. That is where a member has a
 * draft to keep, and therefore the only place a conflict has an answer to offer;
 * the lifecycle commands act on the row in front of the member, are state-aware
 * in the domain, and would otherwise dead-end in a refusal with nothing to
 * reconcile (ADR 0209).
 */

export async function createHouseholdSavedItemAction(input: {
  kind: string;
  title: string;
  content?: string;
  url?: string;
  bringBackAt?: string;
}): Promise<SavedItemMutationResult> {
  return runOwnerAction({
    schema: createHouseholdSchema,
    input,
    // The household is the caller's own active membership, resolved by the same
    // shared path every scoped create uses. A client-supplied household id would
    // let a caller assert standing they may not have.
    visibilityChoice: () => "whole_household",
    body: ({ ownerUserId, input: parsed, resolvedScope }) => {
      if (!resolvedScope?.householdId) throw new SavedItemValidationError(NO_HOUSEHOLD);
      return createHouseholdSavedItem({
        actorUserId: ownerUserId,
        householdId: resolvedScope.householdId,
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content || null,
        url: parsed.url || null,
        bringBackAt: parseOptionalDate(parsed.bringBackAt) ?? null,
        bringBackTimeSemantics: parsed.bringBackAt ? "instant" : "date_only",
        originalText: originalText(parsed),
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

export async function editHouseholdSavedItemAction(input: {
  savedItemId: string;
  expectedVersion?: number;
  title?: string;
  content?: string | null;
  url?: string | null;
  bringBackAt?: string | null;
}): Promise<SavedItemMutationResult> {
  return runOwnerAction({
    schema: editHouseholdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editHouseholdSavedItem({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        expectedVersion: parsed.expectedVersion,
        edit: savedItemEdit(parsed),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

/**
 * Reads one household-native item back, which is how "take theirs" adopts the
 * current value: the surface replaces its projection with what the server
 * actually holds rather than assembling a row from the conflict payload
 * (ADR 0209).
 */
export async function getHouseholdSavedItemViewAction(input: {
  savedItemId: string;
}): Promise<SavedItemMutationResult> {
  return runOwnerAction({
    schema: savedItemIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      getHouseholdSavedItem({ actorUserId: ownerUserId, savedItemId: parsed.savedItemId }),
    result: (item, ownerUserId) => savedItemView(item, ownerUserId),
  });
}

export async function archiveHouseholdSavedItemAction(input: { savedItemId: string }) {
  return runHouseholdSavedItemIdMutation(input, archiveHouseholdSavedItem);
}

export async function restoreHouseholdSavedItemAction(input: { savedItemId: string }) {
  return runHouseholdSavedItemIdMutation(input, restoreHouseholdSavedItem);
}

export async function resolveHouseholdSavedItemAction(input: {
  savedItemId: string;
  reason: string;
}) {
  return runOwnerAction({
    schema: resolveSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      resolveHouseholdSavedItem({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        reason: parsed.reason,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

/** A workspace-owned Saved Item promotes only into a workspace-owned Action. */
export async function promoteHouseholdSavedItemAction(input: {
  savedItemId: string;
  title?: string;
}) {
  return runOwnerAction({
    schema: promoteHouseholdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      promoteHouseholdSavedItem({
        actorUserId: ownerUserId,
        savedItemId: parsed.savedItemId,
        idempotencyKey: `saved-item:${parsed.savedItemId}:household-general-action`,
        title: parsed.title,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

function runHouseholdSavedItemIdMutation(
  input: { savedItemId: string },
  mutate: typeof archiveHouseholdSavedItem,
) {
  return runOwnerAction({
    schema: savedItemIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      mutate({ actorUserId: ownerUserId, savedItemId: parsed.savedItemId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => savedItemView(outcome.result, ownerUserId),
  });
}

/** Archived Saved Items are quiet secondary history, read only when the owner opens it. */
export async function getArchivedSavedItemViewsAction() {
  const callerUserId = await requireAdmittedOwnerForAction();
  const [items, schedules, memberNames] = await Promise.all([
    listSavedItems({ callerUserId, includeArchived: true }),
    listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
    householdMemberNames(callerUserId),
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
      return toSavedItemView(item, {
        callerUserId,
        now,
        reminderSchedule: schedule ? toReminderScheduleView(schedule, "instant") : null,
        memberNames,
      });
    });
}
