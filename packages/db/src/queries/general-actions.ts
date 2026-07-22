import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import { createGeneralActionLifecycle } from "./general-actions/lifecycle";
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
} from "./general-actions/types";
import { reconcileReminderRecord } from "./reminders";
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";

export {
  createDrizzleGeneralActionLifecycleStore,
  createDrizzleGeneralActionStore,
} from "./general-actions/drizzle-store";
export {
  createInMemoryGeneralActionLifecycleStore,
  createInMemoryGeneralActionStore,
} from "./general-actions/in-memory-store";
export { createGeneralActionLifecycle } from "./general-actions/lifecycle";
export { createSuggestedGeneralActionReview } from "./general-actions/review";
export type * from "./general-actions/types";

const defaultGeneralActionStore = createDrizzleGeneralActionLifecycleStore();
// Embed-on-write: content-affecting lifecycle and review paths enqueue (and, outside
// production, immediately run) a semantic-embedding job so General Actions participate in
// semantic retrieval, reusing the shared embedding pipeline (ADR 0150; Phase 5 #184).
const scheduleGeneralActionEmbedding = enqueueAndTriggerSemanticEmbeddingJob;
const defaultGeneralActionLifecycle = createGeneralActionLifecycle(defaultGeneralActionStore, {
  scheduleGeneralActionEmbedding,
});
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
  const action = await defaultGeneralActionLifecycle.editGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function setGeneralActionVisibility(input: SetGeneralActionVisibilityInput) {
  return defaultGeneralActionLifecycle.setGeneralActionVisibility(input);
}

export async function setGeneralActionPeople(input: SetGeneralActionPeopleInput) {
  return defaultGeneralActionLifecycle.setGeneralActionPeople(input);
}

export async function completeGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.completeGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function skipGeneralActionOccurrence(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.skipGeneralActionOccurrence(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function dismissGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.dismissGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function reopenGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.reopenGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function archiveGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.archiveGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function pauseGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.pauseGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function resumeGeneralAction(input: GeneralActionActionInput) {
  const action = await defaultGeneralActionLifecycle.resumeGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
}

export async function deferGeneralAction(input: DeferGeneralActionInput) {
  const action = await defaultGeneralActionLifecycle.deferGeneralAction(input);
  await reconcileGeneralActionReminder(action);
  return action;
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
  return defaultSuggestedGeneralActionReview.suggestGeneralAction(input);
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
  return defaultSuggestedGeneralActionReview.acceptSuggestedGeneralAction(input);
}

export async function editSuggestedGeneralAction(input: EditSuggestedGeneralActionInput) {
  return defaultSuggestedGeneralActionReview.editSuggestedGeneralAction(input);
}

export async function dismissSuggestedGeneralAction(input: GeneralActionActionInput) {
  return defaultSuggestedGeneralActionReview.dismissSuggestedGeneralAction(input);
}

export async function ignoreSuggestedGeneralAction(input: GeneralActionActionInput) {
  return defaultSuggestedGeneralActionReview.ignoreSuggestedGeneralAction(input);
}
