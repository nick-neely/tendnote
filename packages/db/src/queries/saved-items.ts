import { createGeneralAction } from "./general-actions";
import { reconcileReminderRecord } from "./reminders";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";
import { createSavedItemLifecycle } from "./saved-items/lifecycle";
import type { CreateSavedItemInput, EditSavedItemInput } from "./saved-items/types";
import {
  enqueueAndTriggerSemanticEmbeddingJob,
  searchSavedItemsSemantic as searchSavedItemsByMeaning,
} from "./semantic-retrieval";

export {
  createDrizzleSavedItemLifecycleStore,
  createDrizzleSavedItemStore,
} from "./saved-items/drizzle-store";
export {
  createInMemorySavedItemLifecycleStore,
  type InMemorySavedItemLifecycleStore,
} from "./saved-items/in-memory-store";
export { createSavedItemLifecycle } from "./saved-items/lifecycle";
export type * from "./saved-items/types";

const defaultSavedItemLifecycle = createSavedItemLifecycle(createDrizzleSavedItemLifecycleStore(), {
  scheduleEmbedding: enqueueAndTriggerSemanticEmbeddingJob,
  createGeneralAction: (input) => createGeneralAction(input),
});

async function reconcileSavedItemReminder(item: { id: string; ownerUserId: string }) {
  await reconcileReminderRecord({
    ownerUserId: item.ownerUserId,
    recordKind: "saved_item",
    recordId: item.id,
    now: new Date(),
  });
}

export function createSavedItem(input: CreateSavedItemInput) {
  return defaultSavedItemLifecycle.createSavedItem(input);
}

export function getSavedItem(input: { callerUserId: string; savedItemId: string }) {
  return defaultSavedItemLifecycle.getSavedItem(input);
}

export function listSavedItems(input: {
  callerUserId: string;
  includeArchived?: boolean;
  limit?: number;
}) {
  return defaultSavedItemLifecycle.listSavedItems(input);
}

export async function editSavedItem(input: EditSavedItemInput) {
  const item = await defaultSavedItemLifecycle.editSavedItem(input);
  await reconcileSavedItemReminder(item);
  return item;
}

export async function archiveSavedItem(input: { actorUserId: string; savedItemId: string }) {
  const item = await defaultSavedItemLifecycle.archiveSavedItem(input);
  await reconcileSavedItemReminder(item);
  return item;
}

export async function reopenSavedItem(input: { actorUserId: string; savedItemId: string }) {
  const item = await defaultSavedItemLifecycle.reopenSavedItem(input);
  await reconcileSavedItemReminder(item);
  return item;
}

export async function resolveSavedItem(input: {
  actorUserId: string;
  savedItemId: string;
  reason: string;
}) {
  const item = await defaultSavedItemLifecycle.resolveSavedItem(input);
  await reconcileSavedItemReminder(item);
  return item;
}

export function searchSavedItems(input: {
  callerUserId: string;
  query: string;
  includeArchived?: boolean;
  limit?: number;
}) {
  return defaultSavedItemLifecycle.searchSavedItems(input);
}

export function searchSavedItemsSemantic(input: {
  ownerUserId: string;
  query: string;
  includeArchived?: boolean;
  limit?: number;
  minimumSimilarity?: number;
}) {
  return searchSavedItemsByMeaning(input);
}

export function promoteSavedItemToGeneralAction(input: {
  actorUserId: string;
  savedItemId: string;
  authority: "explicit" | "inferred";
  idempotencyKey: string;
  title?: string;
}) {
  return defaultSavedItemLifecycle.promoteSavedItemToGeneralAction(input);
}

export function getSavedItemSourceDeletionImpact(input: {
  actorUserId: string;
  sourceRecordId: string;
}) {
  return defaultSavedItemLifecycle.getSourceDeletionImpact(input);
}

export function deleteUniqueSavedItemSource(input: { actorUserId: string; savedItemId: string }) {
  return defaultSavedItemLifecycle.deleteUniqueSavedItemSource(input);
}
