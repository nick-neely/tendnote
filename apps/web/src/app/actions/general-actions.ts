"use server";

import {
  listLinkedAssetsForGeneralActions,
  promoteGeneralActionAssetHint,
} from "@tendnote/db/queries/assets";
import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
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
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidateActionMutation } from "@/lib/cache/action-mutation-scopes";
import { getCachedActionLedgerViews } from "@/lib/cache/action-views";
import { invalidateReviewOwner } from "@/lib/cache/today-review-mutation-scopes";
import { parseDateInputValue } from "@/lib/followup-view";
import { runActionsMutation } from "@/lib/general-action-mutation";
import {
  type GeneralActionEventView,
  type GeneralActionMutationResult,
  toGeneralActionEventView,
  toGeneralActionLinkedAssetView,
  toGeneralActionView,
} from "@/lib/general-action-view";
import { resolveScopeForCaller } from "@/lib/resolve-scope-for-caller";
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

/**
 * Runs an Action mutation and maps the result to a view for the acting caller, so
 * `owned` reflects whoever is viewing. The refreshed view re-hydrates the action's
 * linked Assets (#199) so a mutation never quietly drops the asset chips from the
 * row it returns. Thin wrapper over the shared runner so the Action and Area
 * server actions share one result-union path.
 */
function runMutation(
  callerUserId: string,
  run: () => Promise<Parameters<typeof toGeneralActionView>[0]>,
): Promise<GeneralActionMutationResult> {
  return runActionsMutation(
    async () => {
      const action = await run();
      // A direct Action write must synchronously expire every owner-scoped
      // projection before its authoritative view crosses back to the client.
      // This prevents a cached Today/linked-Asset/RSC response from reviving an
      // older lifecycle state after the local reconciliation has acknowledged it.
      invalidateActionMutation({ ownerUserId: callerUserId, actionId: action.id });
      const [linkedByAction, reminderSchedules] = await Promise.all([
        listLinkedAssetsForGeneralActions({
          callerUserId,
          generalActionIds: [action.id],
        }),
        listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
      ]);
      const linkedAssets = (linkedByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView);
      return {
        action,
        linkedAssets,
        reminderSchedule:
          reminderSchedules.find((schedule) => schedule.generalActionId === action.id) ?? null,
      };
    },
    ({ action, linkedAssets, reminderSchedule }) =>
      toGeneralActionView(action, { callerUserId, linkedAssets, reminderSchedule }),
  );
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
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = createActionSchema.parse(input);
    const { scope, householdId } = await resolveScopeForCaller(
      ownerUserId,
      parsed.visibilityChoice,
    );
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
      scope,
      householdId,
      selectedUserIds: parsed.selectedUserIds,
    });
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
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = editActionSchema.parse({
      generalActionId: input.generalActionId,
      ...input.edit,
    });
    return editGeneralAction({
      actorUserId: ownerUserId,
      generalActionId: parsed.generalActionId,
      edit: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
        ...(parsed.recurrence !== undefined ? { recurrence: parsed.recurrence } : {}),
        ...(parsed.links !== undefined ? { links: parsed.links } : {}),
        ...(parsed.assetHints !== undefined ? { assetHints: parsed.assetHints } : {}),
        ...(parsed.areaId !== undefined ? { areaId: parsed.areaId } : {}),
      },
    });
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
  const parsed = z
    .object({ generalActionId: z.uuid(), hintLabel: z.string().trim().min(1).max(120) })
    .parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    await promoteGeneralActionAssetHint({ actorUserId: ownerUserId, ...parsed });
    // The proposal lands in the shared Review Queue and (once accepted) on the
    // Assets surface — re-render both alongside the Actions page.
    invalidateReviewOwner(ownerUserId);
    revalidatePath("/assets");
    return getGeneralAction({ actorUserId: ownerUserId, generalActionId: parsed.generalActionId });
  });
}

/** Re-scopes an Action's visibility. Owner-only downstream (ADR 0153). */
export async function setGeneralActionVisibilityAction(input: {
  generalActionId: string;
  visibilityChoice: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<GeneralActionMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = visibilityActionSchema.parse(input);
    const { scope, householdId } = await resolveScopeForCaller(
      ownerUserId,
      parsed.visibilityChoice,
    );
    return setGeneralActionVisibility({
      actorUserId: ownerUserId,
      generalActionId: parsed.generalActionId,
      scope,
      householdId,
      selectedUserIds: parsed.selectedUserIds,
    });
  });
}

/** Replaces an Action's people links (context, not a Follow-Up). Owner-only (ADR 0155). */
export async function setGeneralActionPeopleAction(input: {
  generalActionId: string;
  personIds: string[];
}): Promise<GeneralActionMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = peopleActionSchema.parse(input);
    return setGeneralActionPeople({
      actorUserId: ownerUserId,
      generalActionId: parsed.generalActionId,
      personIds: parsed.personIds,
    });
  });
}

function transitionAction(
  generalActionId: string,
  run: (input: {
    actorUserId: string;
    generalActionId: string;
  }) => Promise<GeneralActionWithContext>,
): Promise<GeneralActionMutationResult> {
  return (async () => {
    const ownerUserId = await requireAdmittedOwnerForAction();
    return runMutation(ownerUserId, () => {
      const parsed = actionIdSchema.parse({ generalActionId });
      return run({ actorUserId: ownerUserId, generalActionId: parsed.generalActionId });
    });
  })();
}

export async function completeGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, completeGeneralAction);
}

export async function skipGeneralActionOccurrenceAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, skipGeneralActionOccurrence);
}

export async function dismissGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, dismissGeneralAction);
}

export async function reopenGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, reopenGeneralAction);
}

export async function restoreGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, restoreGeneralAction);
}

export async function archiveGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, archiveGeneralAction);
}

/** Pauses a Routine (recurring Action). Routine-only downstream (ADR 0148). */
export async function pauseGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, pauseGeneralAction);
}

/** Resumes a paused Routine back to active. */
export async function resumeGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, resumeGeneralAction);
}

export async function deferGeneralActionAction(input: {
  generalActionId: string;
  deferUntil: string;
}): Promise<GeneralActionMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, () => {
    const parsed = deferActionSchema.parse(input);
    return deferGeneralAction({ actorUserId: ownerUserId, ...parsed });
  });
}

/** Clears a set-aside date as the authoritative inverse of deferral. */
export async function undeferGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, undeferGeneralAction);
}

export async function undoRoutineOccurrenceAction(input: {
  expectedDueAt: string;
  generalActionId: string;
  restoreDueAt: string;
}): Promise<GeneralActionMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, () => {
    const parsed = undoRoutineOccurrenceSchema.parse(input);
    return undoRoutineOccurrence({
      actorUserId: ownerUserId,
      expectedDueAt: parsed.expectedDueAt,
      generalActionId: parsed.generalActionId,
      restoreDueAt: parsed.restoreDueAt,
    });
  });
}

export async function listGeneralActionHistoryAction(input: {
  generalActionId: string;
}): Promise<GeneralActionEventView[]> {
  const parsed = actionIdSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const events = await listGeneralActionHistory({
    actorUserId: ownerUserId,
    generalActionId: parsed.generalActionId,
  });

  return events.map((event) => toGeneralActionEventView(event));
}

const secondaryLedgerInputSchema = z.object({ resolvedLimit: z.number().int().min(1).max(50) });

/** Paused and resolved panes load only when their shared disclosure opens. */
export async function getActionSecondaryLedgerViewsAction(input: { resolvedLimit: number }) {
  const { resolvedLimit } = secondaryLedgerInputSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const now = new Date();
  const ledger = await getCachedActionLedgerViews({ ownerUserId, now, resolvedLimit });
  return { paused: ledger.paused, resolved: ledger.resolved };
}

/** People and household choices load only when creating or editing rich Action details. */
export async function getActionComposerOptionsAction() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const [shareableMembers, people] = await Promise.all([
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
    searchPeople({ ownerUserId, limit: 100 }),
  ]);
  return {
    people: people.map((person) => ({ id: person.id, displayName: person.displayName })),
    shareableMembers: shareableMembers.map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
    })),
  };
}

/** Suggested Actions are a separate review pane and fail independently of the ledger. */
export async function getSuggestedActionViewsAction() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const now = new Date();
  const [suggested, areas] = await Promise.all([
    listSuggestedGeneralActionReviews({ ownerUserId }),
    listGeneralActionAreas({ ownerUserId, includeArchived: true }),
  ]);
  const areaNameById = new Map(areas.map((area) => [area.id, area.name]));
  return {
    suggested: suggested.map((review) =>
      toSuggestedGeneralActionReviewView(review, { now, callerUserId: ownerUserId, areaNameById }),
    ),
  };
}
