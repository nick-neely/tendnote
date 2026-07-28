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
  ListGeneralActionsInput,
  ListSuggestedGeneralActionReviewsInput,
  SetGeneralActionPeopleInput,
  SetGeneralActionVisibilityInput,
  SuggestGeneralActionInput,
  UndoRoutineOccurrenceInput,
} from "./general-actions/types";
import { reconcileReminderRecord } from "./reminders";
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

async function reconcileGeneralActionReminder(action: {
  id: string;
  ownerUserId: string;
  recurrence: unknown | null;
}) {
  const currentKind = action.recurrence ? ("routine" as const) : ("general_action" as const);
  for (const recordKind of [
    currentKind,
    currentKind === "routine" ? "general_action" : "routine",
  ] as const) {
    await reconcileReminderRecord({
      ownerUserId: action.ownerUserId,
      recordKind,
      recordId: action.id,
      now: new Date(),
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

export async function completeGeneralAction(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.completeGeneralAction(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
}

export async function skipGeneralActionOccurrence(input: GeneralActionActionInput) {
  const outcome = await defaultGeneralActionLifecycle.skipGeneralActionOccurrence(input);
  await reconcileGeneralActionReminder(outcome.result);
  return outcome;
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
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.dismissSuggestedGeneralAction(input),
  );
}

export async function ignoreSuggestedGeneralAction(input: GeneralActionActionInput) {
  return suggestedGeneralActionMutationOutcome(
    defaultGeneralActionStore,
    defaultSuggestedGeneralActionReview.ignoreSuggestedGeneralAction(input),
  );
}
