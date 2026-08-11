import { createGeneralAction } from "./general-actions";
import { reconcileReminderRecord, revalidateSavedItemReminderSubscribers } from "./reminders";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";
import { householdNativeGeneralActionDestination } from "./saved-items/household-destination";
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

/**
 * The workspace-owned destination, now that #383 gives General Actions a
 * household-native form.
 *
 * Supplying this is the whole of what turns the household destinations on: both
 * boundaries refuse it outright while it is absent rather than landing the
 * household's record in the promoting member's own Action, which is the implicit
 * transfer the two ownership forms exist to prevent. The refusal stays reachable
 * on purpose - it is the safe direction any future build of this seam falls back
 * to - and simply never fires for the ordinary case now.
 */
const createHouseholdNativeGeneralAction = householdNativeGeneralActionDestination((input) =>
  createGeneralAction(input),
);

const defaultSavedItemLifecycle = createAffectedSavedItemLifecycle(
  createSavedItemLifecycle(createDrizzleSavedItemLifecycleStore(), {
    scheduleEmbedding: enqueueAndTriggerSemanticEmbeddingJob,
    createGeneralAction: (input) => createGeneralAction(input),
    // The member-owned **Give to the household** hand-off. The Saved Item is
    // still archived as resolved and never becomes household-native; what the
    // owner is agreeing to is that the new *Action* is the household's.
    createHouseholdNativeGeneralAction,
  }),
);

const defaultHouseholdSavedItems = createAffectedHouseholdSavedItemCollaboration(
  createHouseholdSavedItemCollaboration(createDrizzleSavedItemLifecycleStore(), {
    // A workspace-owned Saved Item has only ever had one possible destination,
    // so this boundary takes no `createGeneralAction` beside it.
    createHouseholdNativeGeneralAction,
  }),
);

/**
 * Keeps every affected reminder in step after a Saved Item changes.
 *
 * Two passes, because a Saved Item can have two different kinds of interested
 * party. Its owner, if it has one, is reconciled as before. Then every member
 * who subscribed a schedule of their own is revalidated - including the owner,
 * harmlessly twice - because a schedule belongs to the member who chose it and
 * nobody else's subscription is derivable from the record
 * (`docs/phase-8/household-saved-items.md`).
 *
 * The subscriber pass is what makes editing, archiving, resolving, or promoting
 * an item regenerate the pending intents of the people watching it, and what
 * supersedes the intents of anyone who has since lost sight of it - the loader
 * it goes through is visibility-scoped, so both outcomes fall out of one call.
 */
async function reconcileSavedItemReminder(item: { id: string; ownerUserId: string | null }) {
  if (item.ownerUserId) {
    await reconcileReminderRecord({
      ownerUserId: item.ownerUserId,
      recordKind: "saved_item",
      recordId: item.id,
      now: new Date(),
    });
  }
  await revalidateSavedItemReminderSubscribers({ savedItemId: item.id });
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

/**
 * Runs a household-native write, then revalidates whoever was watching.
 *
 * The revalidation is here rather than inside the collaboration boundary on
 * purpose: the boundary owns authority, concurrency, and provenance, and giving
 * it a reminder dependency would make the thing that decides who may write also
 * responsible for who gets notified. This module already composes those two
 * concerns for the owner-scoped lifecycle; household-native writes join it.
 */
async function withSubscriberRevalidation<TOutcome extends { result: { id: string } }>(
  run: () => Promise<TOutcome>,
): Promise<TOutcome> {
  const outcome = await run();
  await revalidateSavedItemReminderSubscribers({ savedItemId: outcome.result.id });
  return outcome;
}

export function createHouseholdSavedItem(input: CreateHouseholdSavedItemInput) {
  // No subscribers can exist yet, so a new item needs no revalidation pass.
  return defaultHouseholdSavedItems.createHouseholdSavedItem(input);
}

export function getHouseholdSavedItem(input: { actorUserId: string; savedItemId: string }) {
  return defaultHouseholdSavedItems.getHouseholdSavedItem(input);
}

export function editHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { edit: EditSavedItemInput["edit"] },
) {
  return withSubscriberRevalidation(() => defaultHouseholdSavedItems.editHouseholdSavedItem(input));
}

export function archiveHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
  return withSubscriberRevalidation(() =>
    defaultHouseholdSavedItems.archiveHouseholdSavedItem(input),
  );
}

export function restoreHouseholdSavedItem(input: HouseholdSavedItemMutationInput) {
  return withSubscriberRevalidation(() =>
    defaultHouseholdSavedItems.restoreHouseholdSavedItem(input),
  );
}

export function resolveHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { reason: string },
) {
  return withSubscriberRevalidation(() =>
    defaultHouseholdSavedItems.resolveHouseholdSavedItem(input),
  );
}

export function promoteHouseholdSavedItem(
  input: HouseholdSavedItemMutationInput & { idempotencyKey: string; title?: string },
) {
  return withSubscriberRevalidation(() =>
    defaultHouseholdSavedItems.promoteHouseholdSavedItem(input),
  );
}
