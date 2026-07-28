"use server";

import {
  listLinkedAssetsForGeneralActions,
  promoteGeneralActionAssetHint,
} from "@tendnote/db/queries/assets";
import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import type {
  GeneralActionWithContext,
  MutationOutcome,
} from "@tendnote/db/queries/general-actions";
import {
  archiveGeneralAction,
  completeGeneralAction,
  createGeneralAction,
  deferGeneralAction,
  dismissGeneralAction,
  editGeneralAction,
  getGeneralAction,
  listGeneralActionHistory,
  listSuggestedGeneralActionReviews,
  pauseGeneralAction,
  reopenGeneralAction,
  restoreGeneralAction,
  resumeGeneralAction,
  setGeneralActionPeople,
  setGeneralActionVisibility,
  skipGeneralActionOccurrence,
  undeferGeneralAction,
  undoRoutineOccurrence,
} from "@tendnote/db/queries/general-actions";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchPeople } from "@tendnote/db/queries/people";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { generalActionLinkSchema, generalActionRecurrenceSchema } from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCachedActionLedgerViews } from "@/lib/cache/action-views";
import { invalidateReviewOwner } from "@/lib/cache/today-review-mutation-scopes";
import { parseDateInputValue } from "@/lib/followup-view";
import {
  type GeneralActionMutationResult,
  toGeneralActionEventView,
  toGeneralActionLinkedAssetView,
  toGeneralActionView,
} from "@/lib/general-action-view";
import { runOwnerAction } from "@/lib/owner-action";
import { toSuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";

const actionIdSchema = z.object({ generalActionId: z.uuid() });

// Due dates arrive from a date input as `YYYY-MM-DD`; resolve them to local
// midnight so the chosen day stays stable, mirroring the Follow-Up create path.
const dateInputSchema = z.string().transform(parseDateInputValue);
const dateTimeInputSchema = z.iso.datetime().transform((value) => new Date(value));

const linksSchema = z.array(generalActionLinkSchema).max(10);
// Asset hints arrive as plain subject labels from the client and become structured
// `{ label }` stubs (ADR 0156). Bounded like links so the field stays lightweight.
const assetHintsSchema = z
  .array(z.string().trim().min(1, "An asset hint can't be blank.").max(120))
  .max(10)
  .transform((labels) => labels.map((label) => ({ label })));
const personIdsSchema = z.array(z.uuid()).max(20);
// Bounded so a share request can't smuggle an unbounded id list; a household is small.
const selectedUserIdsSchema = z.array(z.string().min(1)).max(50).optional();

const createActionSchema = z.object({
  title: z.string().trim().min(1, "Name the action.").max(280),
  notes: z.string().trim().min(1).max(2000).optional(),
  dueAt: dateInputSchema.optional(),
  // A cadence makes the new action a Routine; absent/null keeps it one-time (ADR 0148).
  recurrence: generalActionRecurrenceSchema.nullable().optional(),
  links: linksSchema.optional(),
  assetHints: assetHintsSchema.optional(),
  personIds: personIdsSchema.optional(),
  // The primary Area this Action is filed under; verified owner-visible downstream.
  areaId: z.uuid().nullable().optional(),
  // Visibility choice → scope; households resolve downstream (ADR 0153).
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: selectedUserIdsSchema,
});

const editActionSchema = z.object({
  generalActionId: z.uuid(),
  edit: z.object({
    title: z.string().trim().min(1).max(280).optional(),
    // `null` clears the field; `undefined` leaves it untouched.
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
    dueAt: dateInputSchema.nullable().optional(),
    // `null` makes a Routine one-time again; an object sets/changes cadence (ADR 0148).
    recurrence: generalActionRecurrenceSchema.nullable().optional(),
    links: linksSchema.optional(),
    assetHints: assetHintsSchema.optional(),
    // `null` unfiles the Action; `undefined` leaves its Area untouched.
    areaId: z.uuid().nullable().optional(),
  }),
});

const deferActionSchema = z.object({
  generalActionId: z.uuid(),
  deferUntil: dateInputSchema,
});

const undoRoutineOccurrenceSchema = z.object({
  expectedDueAt: dateTimeInputSchema,
  generalActionId: z.uuid(),
  restoreDueAt: dateTimeInputSchema,
});

const visibilityActionSchema = z.object({
  generalActionId: z.uuid(),
  visibilityChoice: visibilityChoiceSchema,
  selectedUserIds: selectedUserIdsSchema,
});

const peopleActionSchema = z.object({
  generalActionId: z.uuid(),
  personIds: personIdsSchema,
});
const noInputSchema = z.undefined();

/** Maps a persisted Action outcome to the authoritative view for its acting owner. */
async function toAuthoritativeActionView(
  callerUserId: string,
  action: Parameters<typeof toGeneralActionView>[0],
) {
  const hydrated = await hydrateAuthoritativeActionView(callerUserId, action);
  return toGeneralActionView(hydrated.action, {
    callerUserId,
    linkedAssets: hydrated.linkedAssets,
    reminderSchedule: hydrated.reminderSchedule,
  });
}

async function hydrateAuthoritativeActionView(
  callerUserId: string,
  action: Parameters<typeof toGeneralActionView>[0],
) {
  const [linkedByAction, reminderSchedules] = await Promise.all([
    listLinkedAssetsForGeneralActions({
      callerUserId,
      generalActionIds: [action.id],
    }),
    listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
  ]);
  return {
    action,
    linkedAssets: (linkedByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
    reminderSchedule:
      reminderSchedules.find((schedule) => schedule.generalActionId === action.id) ?? null,
  };
}

export async function createGeneralActionAction(input: {
  title: string;
  notes?: string;
  dueAt?: string;
  recurrence?: { interval: number; unit: "day" | "week" | "month" | "year" } | null;
  links?: { url: string; label?: string }[];
  assetHints?: string[];
  personIds?: string[];
  areaId?: string | null;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: createActionSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: async ({ ownerUserId, input: parsed, resolvedScope }) => {
      if (!resolvedScope) {
        throw new Error("Owner action visibility scope was not resolved.");
      }
      return createGeneralAction({
        ownerUserId,
        title: parsed.title,
        notes: parsed.notes,
        dueAt: parsed.dueAt,
        recurrence: parsed.recurrence,
        links: parsed.links,
        assetHints: parsed.assetHints,
        personIds: parsed.personIds,
        areaId: parsed.areaId,
        scope: resolvedScope.scope,
        householdId: resolvedScope.householdId,
        selectedUserIds: parsed.selectedUserIds,
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

export async function editGeneralActionAction(input: {
  generalActionId: string;
  edit: {
    title?: string;
    notes?: string | null;
    dueAt?: string | null;
    recurrence?: { interval: number; unit: "day" | "week" | "month" | "year" } | null;
    links?: { url: string; label?: string }[];
    assetHints?: string[];
    areaId?: string | null;
  };
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: editActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        edit: {
          ...(parsed.edit.title !== undefined ? { title: parsed.edit.title } : {}),
          ...(parsed.edit.notes !== undefined ? { notes: parsed.edit.notes } : {}),
          ...(parsed.edit.dueAt !== undefined ? { dueAt: parsed.edit.dueAt } : {}),
          ...(parsed.edit.recurrence !== undefined ? { recurrence: parsed.edit.recurrence } : {}),
          ...(parsed.edit.links !== undefined ? { links: parsed.edit.links } : {}),
          ...(parsed.edit.assetHints !== undefined ? { assetHints: parsed.edit.assetHints } : {}),
          ...(parsed.edit.areaId !== undefined ? { areaId: parsed.edit.areaId } : {}),
        },
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

/**
 * Promotes one of an Action's asset hints into a review-gated Suggested Asset
 * (#199). Opens (or idempotently re-reads) an Asset Review Group in the shared
 * Review Queue — never a silent durable write — and returns the refreshed action
 * view, whose `linkedAssets` now carries the pending (or already-linked) state.
 */
export async function promoteAssetHintAction(input: {
  generalActionId: string;
  hintLabel: string;
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: z.object({
      generalActionId: z.uuid(),
      hintLabel: z.string().trim().min(1).max(120),
    }),
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      await promoteGeneralActionAssetHint({ actorUserId: ownerUserId, ...parsed });
      return getGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      });
    },
    // The proposal lands in Review and, once accepted, Assets. These paths remain
    // until those record families emit affected scopes in their migration tickets.
    reconcile: (_action, ownerUserId) => {
      invalidateReviewOwner(ownerUserId);
      revalidatePath("/assets");
      revalidatePath("/actions");
    },
    result: (action) => toAuthoritativeActionView(action.ownerUserId, action),
  });
}

/** Re-scopes an Action's visibility. Owner-only downstream (ADR 0153). */
export async function setGeneralActionVisibilityAction(input: {
  generalActionId: string;
  visibilityChoice: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: visibilityActionSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) => {
      if (!resolvedScope) {
        throw new Error("Owner action visibility scope was not resolved.");
      }
      return setGeneralActionVisibility({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        scope: resolvedScope.scope,
        householdId: resolvedScope.householdId,
        selectedUserIds: parsed.selectedUserIds,
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

/** Replaces an Action's people links (context, not a Follow-Up). Owner-only (ADR 0155). */
export async function setGeneralActionPeopleAction(input: {
  generalActionId: string;
  personIds: string[];
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: peopleActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setGeneralActionPeople({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        personIds: parsed.personIds,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

function transitionAction(
  input: unknown,
  run: (input: {
    actorUserId: string;
    generalActionId: string;
  }) => Promise<MutationOutcome<GeneralActionWithContext>>,
): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: actionIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      run({ actorUserId: ownerUserId, generalActionId: parsed.generalActionId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

export async function completeGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, completeGeneralAction);
}

export async function skipGeneralActionOccurrenceAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, skipGeneralActionOccurrence);
}

export async function dismissGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, dismissGeneralAction);
}

export async function reopenGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, reopenGeneralAction);
}

export async function restoreGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, restoreGeneralAction);
}

export async function archiveGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, archiveGeneralAction);
}

/** Pauses a Routine (recurring Action). Routine-only downstream (ADR 0148). */
export async function pauseGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, pauseGeneralAction);
}

/** Resumes a paused Routine back to active. */
export async function resumeGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, resumeGeneralAction);
}

export async function deferGeneralActionAction(input: {
  generalActionId: string;
  deferUntil: string;
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: deferActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      deferGeneralAction({ actorUserId: ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

/** Clears a set-aside date as the authoritative inverse of deferral. */
export async function undeferGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input, undeferGeneralAction);
}

export async function undoRoutineOccurrenceAction(input: {
  expectedDueAt: string;
  generalActionId: string;
  restoreDueAt: string;
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: undoRoutineOccurrenceSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      undoRoutineOccurrence({
        actorUserId: ownerUserId,
        expectedDueAt: parsed.expectedDueAt,
        generalActionId: parsed.generalActionId,
        restoreDueAt: parsed.restoreDueAt,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAuthoritativeActionView(outcome.result.ownerUserId, outcome.result),
  });
}

export async function listGeneralActionHistoryAction(input: { generalActionId: string }) {
  return runOwnerAction({
    schema: actionIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      listGeneralActionHistory({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      }),
    result: (events) => events.map((event) => toGeneralActionEventView(event)),
  });
}

const secondaryLedgerInputSchema = z.object({ resolvedLimit: z.number().int().min(1).max(50) });

/** Paused and resolved panes load only when their shared disclosure opens. */
export async function getActionSecondaryLedgerViewsAction(input: { resolvedLimit: number }) {
  return runOwnerAction({
    schema: secondaryLedgerInputSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      getCachedActionLedgerViews({
        ownerUserId,
        now: new Date(),
        resolvedLimit: parsed.resolvedLimit,
      }),
    result: (ledger) => ({ paused: ledger.paused, resolved: ledger.resolved }),
  });
}

/** People and household choices load only when creating or editing rich Action details. */
export async function getActionComposerOptionsAction() {
  return runOwnerAction({
    schema: noInputSchema,
    input: undefined,
    body: async ({ ownerUserId }) =>
      Promise.all([
        listShareableHouseholdMembersForUser({ userId: ownerUserId }),
        searchPeople({ ownerUserId, limit: 100 }),
      ]),
    result: ([shareableMembers, people]) => ({
      people: people.map((person) => ({ id: person.id, displayName: person.displayName })),
      shareableMembers: shareableMembers.map((member) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
      })),
    }),
  });
}

/** Suggested Actions are a separate review pane and fail independently of the ledger. */
export async function getSuggestedActionViewsAction() {
  return runOwnerAction({
    schema: noInputSchema,
    input: undefined,
    body: async ({ ownerUserId }) => ({
      ownerUserId,
      now: new Date(),
      results: await Promise.all([
        listSuggestedGeneralActionReviews({ ownerUserId }),
        listGeneralActionAreas({ ownerUserId, includeArchived: true }),
      ]),
    }),
    result: ({ ownerUserId, now, results: [suggested, areas] }) => {
      const areaNameById = new Map(areas.map((area) => [area.id, area.name]));
      return {
        suggested: suggested.map((review) =>
          toSuggestedGeneralActionReviewView(review, {
            now,
            callerUserId: ownerUserId,
            areaNameById,
          }),
        ),
      };
    },
  });
}
