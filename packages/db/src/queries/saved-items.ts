import { createGeneralAction } from "./general-actions";
import { reconcileReminderRecord } from "./reminders";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";
import { createHouseholdSavedItemCollaboration } from "./saved-items/household-native";
import { createSavedItemLifecycle } from "./saved-items/lifecycle";
import {
  createAffectedHouseholdSavedItemCollaboration,
  createAffectedSavedItemLifecycle,
} from "./saved-items/mutation-lifecycle";
import type {
  CreateHouseholdSavedItemInput,
  CreateSavedItemInput,
  EditSavedItemInput,
  HouseholdSavedItemMutationInput,
} from "./saved-items/types";
import {
  enqueueAndTriggerSemanticEmbeddingJob,
  searchSavedItemsSemantic as searchSavedItemsByMeaning,
} from "./semantic-retrieval";

export {
  createDrizzleSavedItemLifecycleStore,
  createDrizzleSavedItemStore,
} from "./saved-items/drizzle-store";
export { createHouseholdSavedItemCollaboration } from "./saved-items/household-native";
export {
  createInMemorySavedItemLifecycleStore,
  type InMemorySavedItemLifecycleStore,
} from "./saved-items/in-memory-store";
export { createSavedItemLifecycle } from "./saved-items/lifecycle";
export type * from "./saved-items/types";

const defaultSavedItemLifecycle = createAffectedSavedItemLifecycle(
  createSavedItemLifecycle(createDrizzleSavedItemLifecycleStore(), {
    scheduleEmbedding: enqueueAndTriggerSemanticEmbeddingJob,
    createGeneralAction: (input) => createGeneralAction(input),
    // `createHouseholdNativeGeneralAction` is deliberately absent until #383
    // gives General Actions a workspace-owned form. Promotion refuses that
    // destination rather than landing the household's record in the promoting
    // member's own Action — the implicit transfer both ownership forms exist to
    // prevent. Supplying it here is the whole of what turns that path on.
  }),
);

const defaultHouseholdSavedItems = createAffectedHouseholdSavedItemCollaboration(
  createHouseholdSavedItemCollaboration(createDrizzleSavedItemLifecycleStore()),
);

/**
 * Keeps an owner's reminder intents in step with their Saved Item.
 *
 * Household-native items are skipped, and not as an omission: a Reminder
 * Schedule belongs to the member who chose it, and a workspace-owned item has no
 * member whose schedule it could be. Reconciling one would quietly enroll
 * whoever wrote it — exactly what `docs/phase-8/household-saved-items.md`
 * refuses. A shared note sits on Household and nags nobody privately until a
 * member opts in for themselves.
 */
async function reconcileSavedItemReminder(item: { id: string; ownerUserId: string | null }) {
  if (!item.ownerUserId) return;
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
  const outcome = await defaultSavedItemLifecycle.editSavedItem(input);
  await reconcileSavedItemReminder(outcome.result);
  return outcome;
}

export async function archiveSavedItem(input: { actorUserId: string; savedItemId: string }) {
  const outcome = await defaultSavedItemLifecycle.archiveSavedItem(input);
  await reconcileSavedItemReminder(outcome.result);
  return outcome;
}

export async function reopenSavedItem(input: { actorUserId: string; savedItemId: string }) {
  const outcome = await defaultSavedItemLifecycle.reopenSavedItem(input);
  await reconcileSavedItemReminder(outcome.result);
  return outcome;
}

export async function resolveSavedItem(input: {
  actorUserId: string;
  savedItemId: string;
  reason: string;
}) {
  const outcome = await defaultSavedItemLifecycle.resolveSavedItem(input);
  await reconcileSavedItemReminder(outcome.result);
  return outcome;
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
  destination?: "member_owned" | "household_native";
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

/*
 * Household-native Saved Items.
 *
 * Their own entry points rather than flags on the ones above. Every function
 * here takes `actorUserId` and never `ownerUserId`, which is the difference
 * these two ownership forms come down to: nobody owns a workspace-owned record,
 * and each of these proves the actor's current standing before it does anything
 * (ADR 0214, ADR 0219).
 */

export function createHouseholdSavedItem(input: CreateHouseholdSavedItemInput) {
  return defaultHouseholdSavedItems.createHouseholdSavedItem(input);
}

export function getHouseholdSavedItem(input: { actorUserId: string; savedItemId: string }) {
  return defaultHouseholdSavedItems.getHouseholdSavedItem(input);
}

export function editHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { edit: EditSavedItemInput["edit"] },
) {
  return defaultHouseholdSavedItems.editHouseholdSavedItem(input);
}

export function archiveHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
  return defaultHouseholdSavedItems.archiveHouseholdSavedItem(input);
}

export function restoreHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
  return defaultHouseholdSavedItems.restoreHouseholdSavedItem(input);
}

export function resolveHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { reason: string },
) {
  return defaultHouseholdSavedItems.resolveHouseholdSavedItem(input);
}

export function promoteHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { idempotencyKey: string; title?: string },
) {
  return defaultHouseholdSavedItems.promoteHouseholdSavedItem(input);
}
