import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import { createGeneralActionLifecycle } from "./general-actions/lifecycle";
import type {
  CreateActiveGeneralActionInput,
  DeferGeneralActionInput,
  EditGeneralActionInput,
  GeneralActionActionInput,
  ListGeneralActionsInput,
  SetGeneralActionPeopleInput,
  SetGeneralActionVisibilityInput,
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
export type * from "./general-actions/types";

const defaultGeneralActionStore = createDrizzleGeneralActionLifecycleStore();
const defaultGeneralActionLifecycle = createGeneralActionLifecycle(defaultGeneralActionStore);

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

export async function deferGeneralAction(input: DeferGeneralActionInput) {
  return defaultGeneralActionLifecycle.deferGeneralAction(input);
}

export async function listActiveGeneralActions(input: ListGeneralActionsInput) {
  return defaultGeneralActionLifecycle.listActiveGeneralActions(input);
}

export async function listResolvedGeneralActions(input: ListGeneralActionsInput) {
  return defaultGeneralActionLifecycle.listResolvedGeneralActions(input);
}

export async function getGeneralAction(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.getGeneralAction(input);
}

export async function listGeneralActionHistory(input: GeneralActionActionInput) {
  return defaultGeneralActionLifecycle.listGeneralActionHistory(input);
}
