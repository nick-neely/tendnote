import type { GeneralActionOfferKind } from "@tendnote/domain";
import { shouldOfferResponsibilityHandoff } from "@tendnote/domain";
import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import {
  createAffectedGeneralActionLifecycle,
  suggestedGeneralActionMutationOutcome,
} from "./general-actions/mutation-lifecycle";
import { createSuggestedGeneralActionReview } from "./general-actions/review";
import type {
  AcceptSuggestedGeneralActionInput,
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  EditSuggestedGeneralActionInput,
  GeneralActionActionInput,
  GeneralActionProgressInput,
  HandGeneralActionToHouseholdInput,
  ListGeneralActionsInput,
  ListSuggestedGeneralActionReviewsInput,
  SetGeneralActionPeopleInput,
  SetGeneralActionVisibilityInput,
  SetResponsibilityHolderInput,
  SuggestGeneralActionInput,
  UndoRoutineOccurrenceInput,
} from "./general-actions/types";
import {
  clearGeneralActionReminder,
  listReminderSchedulesForOwner,
  reconcileReminderRecordForSubscribers,
} from "./reminders";
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";

export * from "./affected-scopes";
export {
  createDrizzleGeneralActionLifecycleStore,
  createDrizzleGeneralActionStore,
} from "./general-actions/drizzle-store";
export {
  createInMemoryGeneralActionLifecycleStore,
  createInMemoryGeneralActionStore,
} from "./general-actions/in-memory-store";
export { createGeneralActionLifecycle } from "./general-actions/lifecycle";
export { createAffectedGeneralActionLifecycle } from "./general-actions/mutation-lifecycle";
export { createSuggestedGeneralActionReview } from "./general-actions/review";
export type * from "./general-actions/types";

const defaultGeneralActionStore = createDrizzleGeneralActionLifecycleStore();
// Embed-on-write: content-affecting lifecycle and review paths enqueue (and, outside
// production, immediately run) a semantic-embedding job so General Actions participate in
// semantic retrieval, reusing the shared embedding pipeline (ADR 0150; Phase 5 #184).
const scheduleGeneralActionEmbedding = enqueueAndTriggerSemanticEmbeddingJob;
const defaultGeneralActionLifecycle = createAffectedGeneralActionLifecycle(
  defaultGeneralActionStore,
  {
    scheduleGeneralActionEmbedding,
  },
);
const defaultSuggestedGeneralActionReview = createSuggestedGeneralActionReview(
  defaultGeneralActionStore,
  { scheduleGeneralActionEmbedding },
);

/**
 * Brings every member's pending reminder intent back in line with the record.
 *
 * Both record kinds are reconciled because a cadence edit turns an Action into a
 * Routine and back, and the stale side's schedule has to be superseded rather
 * than left holding an alert for a shape the record no longer has.
 *
 * The fan-out across subscribers is the Phase Eight part. A completion, skip,
 * pause, archive, or recurrence change by *any* authorized member invalidates
 * *every* subscribed member's intent for the affected occurrence and regenerates
 * the replacement where one is still warranted — otherwise the partner who did
 * not press the button would be reminded tonight about an occurrence that is
 * already handled. Each subscriber reconciles on their own standing, so a member
 * who has since left has their intent superseded and nobody else's is touched.
 */
async function reconcileGeneralActionReminder(action: {
  id: string;
  ownerUserId: string;
  recurrence: unknown | null;
}) {
  const currentKind = action.recurrence ? ("routine" as const) : ("general_action" as const);
  const now = new Date();
  for (const recordKind of [
    currentKind,
    currentKind === "routine" ? "general_action" : "routine",
  ] as const) {
    await reconcileReminderRecordForSubscribers({
      recordKind,
      recordId: action.id,
      now,
    });
  }
}

export async function createGeneralAction(input: CreateActiveGeneralActionInput) {
  return defaultGeneralActionLifecycle.createGeneralAction(input);
}

export async function editGeneralAction(input: EditGeneralActionInput) {
  const outcome = await defaultGeneralActionLifecycle.editGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function setGeneralActionVisibility(input: SetGeneralActionVisibilityInput) {
  return defaultGeneralActionLifecycle.setGeneralActionVisibility(input);
}

export async function setGeneralActionPeople(input: SetGeneralActionPeopleInput) {
  return defaultGeneralActionLifecycle.setGeneralActionPeople(input);
}

export async function completeGeneralAction(input: GeneralActionProgressInput) {
  const outcome = await defaultGeneralActionLifecycle.completeGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function skipGeneralActionOccurrence(input: GeneralActionProgressInput) {
  const outcome = await defaultGeneralActionLifecycle.skipGeneralActionOccurrence(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

/**
 * Names, changes, or clears who is looking after a household-native record.
 *
 * Nothing here creates a reminder: a named holder is *offered* their own
 * schedule and answers for themselves, because no member's action may put an
 * alert on another member's device (ADR 0203).
 *
 * It can *remove* one, and only in the single case the contract allows — the
 * outgoing holder handing the record on and choosing, in the same confirmation,
 * to let their own reminder go with it. The previous holder is read here rather
 * than taken from the caller, and the removal is skipped unless that person is
 * the one acting, so nobody can drop an alert from someone else's phone.
 */
export async function setResponsibilityHolder(input: SetResponsibilityHolderInput) {
  const previous = await defaultGeneralActionLifecycle.getGeneralAction(input);
  const outgoingHolderIsActor = previous.responsibilityHolderUserId === input.actorUserId;
  const outcome = await defaultGeneralActionLifecycle.setResponsibilityHolder(input);
  if (input.removeOutgoingReminder === true && outgoingHolderIsActor) {
    await clearGeneralActionReminder({
      ownerUserId: input.actorUserId,
      generalActionId: input.generalActionId,
      now: new Date(),
    });
  }
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

/** Hands a member-owned record over to the household, in place and one-way. */
export async function handGeneralActionToHousehold(input: HandGeneralActionToHouseholdInput) {
  const outcome = await defaultGeneralActionLifecycle.handGeneralActionToHousehold(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

/** The household's own Actions and Routines, for the Household home and sweeps. */
export async function listGeneralActionsForHousehold(
  input: Parameters<typeof defaultGeneralActionLifecycle.listGeneralActionsForHousehold>[0],
) {
  return defaultGeneralActionLifecycle.listGeneralActionsForHousehold(input);
}

/**
 * Whether to offer this member their own Reminder Schedule for this record.
 *
 * The whole holder-offer rule in one answer, so no surface has to reassemble it
 * and get a piece of it wrong. Every clause is load-bearing:
 *
 * - only a household-native record, because only those name a holder;
 * - only the named member, asked in their *own* surfaces — a member cannot be
 *   offered, let alone enrolled, by anyone else's action (ADR 0203);
 * - only when the record has a due date, since a reminder has nothing to be
 *   early relative to without one;
 * - only when they hold no schedule for it already, so it is an offer rather
 *   than a nag;
 * - and only once, because declining is remembered.
 *
 * The offer itself is never a push notification. An unconsented alert is exactly
 * what this contract refuses, so the invitation has to arrive somewhere the
 * member already chose to look.
 */
export async function shouldOfferResponsibilityHolderReminder(input: {
  actorUserId: string;
  generalActionId: string;
}): Promise<boolean> {
  const action = await defaultGeneralActionLifecycle.getGeneralAction(input);
  if (
    action.ownership !== "household_native" ||
    action.responsibilityHolderUserId !== input.actorUserId ||
    action.dueAt === null
  ) {
    return false;
  }
  const [schedules, declined] = await Promise.all([
    listReminderSchedulesForOwner({ ownerUserId: input.actorUserId }),
    defaultGeneralActionStore.listGeneralActionOfferDeclines({
      generalActionId: action.id,
      offerKind: "holder_reminder",
    }),
  ]);
  if (declined.includes(input.actorUserId)) return false;
  return !schedules.some((schedule) => schedule.recordId === action.id);
}

/**
 * Whether to offer this member the in-place hand-off after they settle an
 * occurrence.
 *
 * The rule itself is the domain's ({@link shouldOfferResponsibilityHandoff});
 * what this adds is the one stored fact it needs — whether this member has
 * already said no for this record. A settled chore therefore asks once and then
 * goes quiet for good, while a household that keeps handing off keeps the
 * shortcut (ADR 0215).
 */
export async function shouldOfferResponsibilityHandoffTo(input: {
  actorUserId: string;
  generalActionId: string;
  candidateCount: number;
}): Promise<boolean> {
  const action = await defaultGeneralActionLifecycle.getGeneralAction(input);
  const declined = await defaultGeneralActionStore.listGeneralActionOfferDeclines({
    generalActionId: action.id,
    offerKind: "responsibility_handoff",
  });
  return shouldOfferResponsibilityHandoff({
    ownership: action.ownership,
    isRoutine: action.recurrence !== null,
    actorHasDeclinedHandoff: declined.includes(input.actorUserId),
    candidateCount: input.candidateCount,
  });
}

/** Remembers one member's "no thanks", so that offer is never made again. */
export async function declineGeneralActionOffer(input: {
  generalActionId: string;
  userId: string;
  offerKind: GeneralActionOfferKind;
}) {
  return defaultGeneralActionStore.declineGeneralActionOffer(input);
}

export async function dismissGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.dismissGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function reopenGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.reopenGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function restoreGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.restoreGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function archiveGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.archiveGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function pauseGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.pauseGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function resumeGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.resumeGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function deferGeneralAction(input: DeferGeneralActionInput) {
  const outcome = await defaultGeneralActionLifecycle.deferGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function undoRoutineOccurrence(input: UndoRoutineOccurrenceInput) {
  const outcome = await defaultGeneralActionLifecycle.undoRoutineOccurrence(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function undeferGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.undeferGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function listActiveGeneralActions(input: ListGeneralActionsInput) {
  return defaultGeneralActionLifecycle.listActiveGeneralActions(input);
}

export async function listResolvedGeneralActions(input: ListGeneralActionsInput) {
  return defaultGeneralActionLifecycle.listResolvedGeneralActions(input);
}

export async function listPausedGeneralActions(input: ListGeneralActionsInput) {
  return defaultGeneralActionLifecycle.listPausedGeneralActions(input);
}

export async function getGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.getGeneralAction(input);
}

export async function listGeneralActionHistory(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.listGeneralActionHistory(input);
}

export async function suggestGeneralAction(input: SuggestGeneralActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.suggestGeneralAction(input),
  );
}

export async function listSuggestedGeneralActionReviews(
  input: ListSuggestedGeneralActionReviewsInput,
) {
  return defaultSuggestedGeneralActionReview.listSuggestedGeneralActionReviews(input);
}

export async function getSuggestedGeneralActionReview(input: GeneralActionActionInput) {
  return defaultSuggestedGeneralActionReview.getSuggestedGeneralActionReview(input);
}

export async function acceptSuggestedGeneralAction(input: AcceptSuggestedGeneralActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.acceptSuggestedGeneralAction(input),
    { includeCurrentAudience: true },
  );
}

export async function editSuggestedGeneralAction(input: EditSuggestedGeneralActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.editSuggestedGeneralAction(input),
  );
}

export async function dismissSuggestedGeneralAction(input: GeneralActionActionInput) {
  const outcome = await suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.dismissSuggestedGeneralAction(input),
  );
  return {
    ...outcome,
    result: await defaultGeneralActionLifecycle.getGeneralAction(input),
  };
}

export async function restoreDismissedSuggestedGeneralAction(input: GeneralActionActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.restoreDismissedSuggestedGeneralAction(input),
  );
}

export async function ignoreSuggestedGeneralAction(input: GeneralActionActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.ignoreSuggestedGeneralAction(input),
  );
}
