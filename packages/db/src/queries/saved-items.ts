import { createGeneralAction } from "./general-actions";
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

export function editSavedItem(input: EditSavedItemInput) {
  return defaultSavedItemLifecycle.editSavedItem(input);
}

export function archiveSavedItem(input: { actorUserId: string; savedItemId: string }) {
  return defaultSavedItemLifecycle.archiveSavedItem(input);
}

export function reopenSavedItem(input: { actorUserId: string; savedItemId: string }) {
  return defaultSavedItemLifecycle.reopenSavedItem(input);
}

export function resolveSavedItem(input: {
  actorUserId: string;
  savedItemId: string;
  reason: string;
}) {
  return defaultSavedItemLifecycle.resolveSavedItem(input);
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
