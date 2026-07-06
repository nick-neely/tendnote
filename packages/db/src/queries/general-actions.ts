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
const defaultGeneralActionLifecycle = createGeneralActionLifecycle(defaultGeneralActionStore);
const defaultSuggestedGeneralActionReview =
  createSuggestedGeneralActionReview(defaultGeneralActionStore);

export async function createGeneralAction(input: CreateActiveGeneralActionInput) {
  return defaultGeneralActionLifecycle.createGeneralAction(input);
}

export async function editGeneralAction(input: EditGeneralActionInput) {
  return defaultGeneralActionLifecycle.editGeneralAction(input);
}

export async function setGeneralActionVisibility(input: SetGeneralActionVisibilityInput) {
  return defaultGeneralActionLifecycle.setGeneralActionVisibility(input);
}

export async function setGeneralActionPeople(input: SetGeneralActionPeopleInput) {
  return defaultGeneralActionLifecycle.setGeneralActionPeople(input);
}

export async function completeGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.completeGeneralAction(input);
}

export async function dismissGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.dismissGeneralAction(input);
}

export async function reopenGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.reopenGeneralAction(input);
}

export async function archiveGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.archiveGeneralAction(input);
}

export async function pauseGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.pauseGeneralAction(input);
}

export async function resumeGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.resumeGeneralAction(input);
}

export async function deferGeneralAction(input: DeferGeneralActionInput) {
  return defaultGeneralActionLifecycle.deferGeneralAction(input);
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
