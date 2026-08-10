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
  declineGeneralActionOffer,
  deferGeneralAction,
  dismissGeneralAction,
  editGeneralAction,
  getGeneralAction,
  handGeneralActionToHousehold,
  listGeneralActionHistory,
  listSuggestedGeneralActionReviews,
  pauseGeneralAction,
  reopenGeneralAction,
  restoreGeneralAction,
  resumeGeneralAction,
  setGeneralActionPeople,
  setGeneralActionVisibility,
  setResponsibilityHolder,
  shouldOfferResponsibilityHandoffTo,
  shouldOfferResponsibilityHolderReminder,
  skipGeneralActionOccurrence,
  undeferGeneralAction,
  undoRoutineOccurrence,
} from "@tendnote/db/queries/general-actions";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchPeople } from "@tendnote/db/queries/people";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import {
  generalActionLinkSchema,
  generalActionOfferKindSchema,
  generalActionRecurrenceSchema,
} from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { getCachedActionLedgerViews } from "@/lib/cache/action-views";
import { parseDateInputValue } from "@/lib/followup-view";
import {
  type GeneralActionMutationResult,
  type GeneralActionProgressResult,
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

/**
 * Maps a persisted Action outcome to the authoritative view for the member who
 * acted.
 *
 * The caller is the *acting* member rather than the record's `ownerUserId`: a
 * co-member may complete a shared Action, and every member holds the same
 * authority over a household-native one, whose `ownerUserId` is a storage key
 * and not a person the view may speak about (ADR 0214). Reading it as the viewer
 * would tell the acting member they own a record they do not, and would resolve
 * "You're looking after this" against the wrong person.
 */
async function toAuthoritativeActionView(
  callerUserId: string,
  action: Parameters<typeof toGeneralActionView>[0],
) {
  const hydrated = await hydrateAuthoritativeActionView(callerUserId, action);
  return toGeneralActionView(hydrated.action, {
    callerUserId,
    linkedAssets: hydrated.linkedAssets,
    memberNames: hydrated.memberNames,
    reminderSchedule: hydrated.reminderSchedule,
  });
}

async function hydrateAuthoritativeActionView(
  callerUserId: string,
  action: Parameters<typeof toGeneralActionView>[0],
) {
  const namesNeeded =
    action.ownership === "household_native" && action.responsibilityHolderUserId !== null;
  const [linkedByAction, reminderSchedules, members] = await Promise.all([
    listLinkedAssetsForGeneralActions({
      callerUserId,
      generalActionIds: [action.id],
    }),
    listReminderSchedulesForOwner({ ownerUserId: callerUserId }),
    namesNeeded ? listShareableHouseholdMembersForUser({ userId: callerUserId }) : null,
  ]);
  return {
    action,
    linkedAssets: (linkedByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
    memberNames: members
      ? new Map(members.map((member) => [member.userId, member.name]))
      : undefined,
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
      // Creation asks one question — who this is for — and "the whole household"
      // is answered with a record the household owns, not one of mine that everyone
      // can read. A shared chore almost always means the former, and the two are
      // not recoverable from one another afterwards: widening visibility never
      // transfers ownership, and there is no claim-back path (ADR 0214).
      //
      // Area and people links are deliberately forwarded rather than quietly
      // stripped. They are one member's own records, so the lifecycle refuses them
      // on a household-native record with a curated sentence that explains why; the
      // composer hides both fields so an ordinary capture never reaches it.
      return createGeneralAction({
        ownerUserId,
        ...(parsed.visibilityChoice === "whole_household"
          ? { ownership: "household_native" as const }
          : {}),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
      const promotion = await promoteGeneralActionAssetHint({
        actorUserId: ownerUserId,
        ...parsed,
      });
      const action = await getGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      });
      return { promotion, action };
    },
    affectedScopes: (outcome) => outcome.promotion.affectedScopes,
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.action),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
  });
}

const progressActionSchema = z.object({
  generalActionId: z.uuid(),
  // Absent on a private Action, which has nobody to race with. Every shared
  // surface sends the occurrence its row was rendered against.
  expectedOccurrenceVersion: z.number().int().min(0).optional(),
});

/**
 * Completing or skipping, fenced on the occurrence the member actually saw.
 *
 * A second member acting on the same occurrence is *reconciled*, never refused:
 * the record advances once, and this returns the settled state along with who
 * settled it and when, so the surface can say so plainly instead of showing the
 * member an error for a truthful report that arrived second (ADR 0214). The
 * name lookup only runs when there is something to name.
 */
function progressAction(
  input: unknown,
  run: (input: {
    actorUserId: string;
    generalActionId: string;
    expectedOccurrenceVersion?: number;
  }) => Promise<
    MutationOutcome<
      GeneralActionWithContext & {
        reconciliation: {
          handledAs: "completed" | "skipped";
          handledByUserId: string | null;
          handledAt: Date;
        } | null;
      }
    >
  >,
): Promise<GeneralActionProgressResult> {
  return runOwnerAction({
    schema: progressActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      run({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        ...(parsed.expectedOccurrenceVersion !== undefined
          ? { expectedOccurrenceVersion: parsed.expectedOccurrenceVersion }
          : {}),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, callerUserId) => {
      const view = await toAuthoritativeActionView(callerUserId, outcome.result);
      const reconciliation = outcome.result.reconciliation;
      if (!reconciliation) return { ...view, reconciliation: null };
      const handledByUserId = reconciliation.handledByUserId;
      const members = handledByUserId
        ? await listShareableHouseholdMembersForUser({ userId: callerUserId })
        : [];
      return {
        ...view,
        reconciliation: {
          handledAs: reconciliation.handledAs,
          handledByUserId,
          handledByName: members.find((member) => member.userId === handledByUserId)?.name ?? null,
          handledAtISO: reconciliation.handledAt.toISOString(),
        },
      };
    },
  });
}

export async function completeGeneralActionAction(input: {
  generalActionId: string;
  expectedOccurrenceVersion?: number;
}): Promise<GeneralActionProgressResult> {
  return progressAction(input, completeGeneralAction);
}

export async function skipGeneralActionOccurrenceAction(input: {
  generalActionId: string;
  expectedOccurrenceVersion?: number;
}): Promise<GeneralActionProgressResult> {
  return progressAction(input, skipGeneralActionOccurrence);
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

const responsibilityHolderSchema = z.object({
  generalActionId: z.uuid(),
  // `null` is a real answer — "no one in particular" — not a missing value.
  holderUserId: z.string().min(1).nullable(),
  handedOff: z.boolean().optional(),
  removeOutgoingReminder: z.boolean().optional(),
});

/**
 * Names, changes, or clears who is looking after a household-native record.
 *
 * Any active member may say it, and it grants the named member nothing: it gates
 * no authority, moves no work, and is never advanced by Tendnote. `handedOff`
 * only marks the one-tap hand-off offered at completion so history can tell that
 * story apart from a plain edit; `removeOutgoingReminder` is honoured downstream
 * only when the acting member is the outgoing holder, because an alert on
 * someone else's device is theirs to keep (ADRs 0203, 0215).
 */
export async function setResponsibilityHolderAction(input: {
  generalActionId: string;
  holderUserId: string | null;
  handedOff?: boolean;
  removeOutgoingReminder?: boolean;
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: responsibilityHolderSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setResponsibilityHolder({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        holderUserId: parsed.holderUserId,
        ...(parsed.handedOff !== undefined ? { handedOff: parsed.handedOff } : {}),
        ...(parsed.removeOutgoingReminder !== undefined
          ? { removeOutgoingReminder: parsed.removeOutgoingReminder }
          : {}),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
  });
}

/**
 * Hands a member-owned Action over to the household. Owner-only, confirmed, and
 * one-way: the record stays with the household if its author leaves, every active
 * member may edit it, and there is no path back (ADR 0214).
 */
export async function handGeneralActionToHouseholdAction(input: {
  generalActionId: string;
  responsibilityHolderUserId?: string | null;
}): Promise<GeneralActionMutationResult> {
  return runOwnerAction({
    schema: z.object({
      generalActionId: z.uuid(),
      responsibilityHolderUserId: z.string().min(1).nullable().optional(),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      handGeneralActionToHousehold({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        ...(parsed.responsibilityHolderUserId !== undefined
          ? { responsibilityHolderUserId: parsed.responsibilityHolderUserId }
          : {}),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
  });
}

/**
 * Whether to invite this member to set their own Reminder Schedule for a record
 * they are named as looking after.
 *
 * The rule lives in one place server-side, so this surface asks rather than
 * reassembles it: household-native only, the named member only, in their own
 * surfaces only, only when they hold no schedule for it, and never after they
 * have said no. It is an offer inside a surface the member already opened —
 * never a push, because an unconsented alert is precisely what the reminder
 * contract refuses (ADR 0203).
 */
export async function getResponsibilityHolderReminderOfferAction(input: {
  generalActionId: string;
}) {
  return runOwnerAction({
    schema: actionIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      shouldOfferResponsibilityHolderReminder({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      }),
    result: (offer) => ({ offer }),
  });
}

/**
 * Whether to offer this member the hand-off after they settled an occurrence.
 *
 * Asked of the server rather than decided on the row, because the answer turns
 * on a stored fact — whether this member has already said no for this record —
 * and because "a settled chore is named once and never touched again" has to
 * hold across reloads and devices, not just for the life of one component
 * (ADR 0215).
 */
export async function getResponsibilityHandoffOfferAction(input: {
  generalActionId: string;
  candidateCount: number;
}) {
  return runOwnerAction({
    schema: z.object({
      generalActionId: z.uuid(),
      candidateCount: z.number().int().min(0).max(50),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      shouldOfferResponsibilityHandoffTo({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        candidateCount: parsed.candidateCount,
      }),
    result: (offer) => ({ offer }),
  });
}

/** Remembers this member's "no thanks", so that offer is never made again. */
export async function declineGeneralActionOfferAction(input: {
  generalActionId: string;
  offerKind: "holder_reminder" | "responsibility_handoff";
}) {
  return runOwnerAction({
    schema: z.object({
      generalActionId: z.uuid(),
      offerKind: generalActionOfferKindSchema,
    }),
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      await declineGeneralActionOffer({
        generalActionId: parsed.generalActionId,
        userId: ownerUserId,
        offerKind: parsed.offerKind,
      });
      return null;
    },
    result: () => ({ declined: true }),
  });
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
    result: (outcome, callerUserId) => toAuthoritativeActionView(callerUserId, outcome.result),
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
