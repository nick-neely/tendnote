import { createDrizzleFollowupLifecycleStore } from "./followups/drizzle-store";
import { createFollowupLifecycle } from "./followups/lifecycle";
import type {
  CreateActiveFollowupInput,
  EditFollowupInput,
  FollowupActionInput,
  SnoozeFollowupInput,
} from "./followups/types";

export {
  createDrizzleFollowupLifecycleStore,
  createDrizzleFollowupStore,
} from "./followups/drizzle-store";
export {
  createInMemoryFollowupLifecycleStore,
  createInMemoryFollowupStore,
} from "./followups/in-memory-store";
export { createFollowupLifecycle } from "./followups/lifecycle";
export type * from "./followups/types";

const defaultFollowupStore = createDrizzleFollowupLifecycleStore();
const defaultFollowupLifecycle = createFollowupLifecycle(defaultFollowupStore);

export async function createFollowup(input: CreateActiveFollowupInput) {
  return defaultFollowupLifecycle.createFollowup(input);
}

export async function editFollowup(input: EditFollowupInput) {
  return defaultFollowupLifecycle.editFollowup(input);
}

export async function completeFollowup(input: FollowupActionInput) {
  return defaultFollowupLifecycle.completeFollowup(input);
}

export async function dismissFollowup(input: FollowupActionInput) {
  return defaultFollowupLifecycle.dismissFollowup(input);
}

export async function snoozeFollowup(input: SnoozeFollowupInput) {
  return defaultFollowupLifecycle.snoozeFollowup(input);
}

export async function reopenFollowup(input: FollowupActionInput) {
  return defaultFollowupLifecycle.reopenFollowup(input);
}

export async function archiveFollowup(input: FollowupActionInput) {
  return defaultFollowupLifecycle.archiveFollowup(input);
}

export async function listActiveFollowups(input: {
  ownerUserId: string;
  personId?: string;
  dueBefore?: Date;
  limit?: number;
}) {
  return defaultFollowupLifecycle.listActiveFollowups(input);
}
