import {
  birthdayAnnualFollowupCadence,
  nextBirthdayFollowupDueAt,
  type ReminderScheduleChoice,
} from "@tendnote/domain";
import { createDrizzleFollowupLifecycleStore } from "./followups/drizzle-store";
import {
  createAffectedFollowupLifecycle,
  createAffectedSuggestedFollowupReview,
} from "./followups/mutation-lifecycle";
import type {
  AcceptSuggestedFollowupInput,
  CreateActiveFollowupInput,
  EditFollowupInput,
  EditSuggestedFollowupInput,
  FollowupActionInput,
  ListSuggestedFollowupReviewsInput,
  SnoozeFollowupInput,
  SuggestFollowupInput,
} from "./followups/types";
import { getPerson } from "./people";
import { reconcileReminderRecord, saveReminder } from "./reminders";

export {
  createDrizzleFollowupLifecycleStore,
  createDrizzleFollowupStore,
} from "./followups/drizzle-store";
export {
  createInMemoryFollowupLifecycleStore,
  createInMemoryFollowupStore,
} from "./followups/in-memory-store";
export { createFollowupLifecycle } from "./followups/lifecycle";
export {
  createAffectedFollowupLifecycle,
  createAffectedSuggestedFollowupReview,
} from "./followups/mutation-lifecycle";
export { createSuggestedFollowupReview } from "./followups/review";
export type * from "./followups/types";

const defaultFollowupStore = createDrizzleFollowupLifecycleStore();
const defaultFollowupLifecycle = createAffectedFollowupLifecycle(defaultFollowupStore);
const defaultSuggestedFollowupReview = createAffectedSuggestedFollowupReview(defaultFollowupStore);

async function reconcileFollowupReminder(followup: { id: string; ownerUserId: string }) {
  await reconcileReminderRecord({
    ownerUserId: followup.ownerUserId,
    recordKind: "follow_up",
    recordId: followup.id,
    now: new Date(),
  });
}

export async function createFollowup(input: CreateActiveFollowupInput) {
  return defaultFollowupLifecycle.createFollowup(input);
}

export async function editFollowup(input: EditFollowupInput) {
  const outcome = await defaultFollowupLifecycle.editFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function getFollowup(input: FollowupActionInput) {
  return defaultFollowupLifecycle.getFollowup(input);
}

export async function completeFollowup(input: FollowupActionInput) {
  const outcome = await defaultFollowupLifecycle.completeFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function dismissFollowup(input: FollowupActionInput) {
  const outcome = await defaultFollowupLifecycle.dismissFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function snoozeFollowup(input: SnoozeFollowupInput) {
  const outcome = await defaultFollowupLifecycle.snoozeFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function reopenFollowup(input: FollowupActionInput) {
  const outcome = await defaultFollowupLifecycle.reopenFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function archiveFollowup(input: FollowupActionInput) {
  const outcome = await defaultFollowupLifecycle.archiveFollowup(input);
  await reconcileFollowupReminder(outcome.result);
  return outcome;
}

export async function listActiveFollowups(input: {
  ownerUserId: string;
  personId?: string;
  dueBefore?: Date;
  limit?: number;
}) {
  return defaultFollowupLifecycle.listActiveFollowups(input);
}

export async function listFollowupsForPerson(input: { ownerUserId: string; personId: string }) {
  return defaultFollowupStore.listFollowupsForPerson(input);
}

export async function searchFollowups(input: {
  ownerUserId: string;
  includeArchived?: boolean;
  limit?: number;
}) {
  return defaultFollowupLifecycle.searchFollowups(input);
}

export async function createBirthdayFollowupReminder(input: {
  ownerUserId: string;
  personId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: Extract<ReminderScheduleChoice, { kind: "relative" }>;
  now: Date;
}) {
  const person = await getPerson({ ownerUserId: input.ownerUserId, personId: input.personId });
  if (!person?.birthday) throw new Error("Save a Birthday before creating its Follow-Up.");
  const dueAt = nextBirthdayFollowupDueAt({
    birthday: person.birthday,
    now: input.now,
    timeZone: input.timeZone,
  });
  const reason = `Celebrate ${person.displayName}'s birthday`;
  const existing = (
    await listActiveFollowups({
      ownerUserId: input.ownerUserId,
      personId: person.id,
    })
  ).find(
    ({ followup }) =>
      followup.cadence === birthdayAnnualFollowupCadence && followup.reason === reason,
  )?.followup;
  const followup =
    existing ??
    (
      await defaultFollowupLifecycle.createFollowup({
        ownerUserId: input.ownerUserId,
        personId: person.id,
        reason,
        dueAt,
        cadence: birthdayAnnualFollowupCadence,
        scope: "private",
      })
    ).result;
  const reminder = await saveReminder({
    ownerUserId: input.ownerUserId,
    recordKind: "follow_up",
    recordId: followup.id,
    clientInstallationId: input.clientInstallationId,
    timeZone: input.timeZone,
    schedule: input.schedule,
    now: input.now,
  });
  return {
    result: { followup, reminder },
    affectedScopes: [
      {
        kind: "owner-collection" as const,
        collection: "people" as const,
        ownerUserId: followup.ownerUserId,
      },
      {
        kind: "viewer-entity" as const,
        entity: "person" as const,
        entityId: followup.personId,
        viewerUserId: followup.ownerUserId,
      },
      { kind: "visible-entity" as const, entity: "person" as const, entityId: followup.personId },
      {
        kind: "owner-collection" as const,
        collection: "today" as const,
        ownerUserId: followup.ownerUserId,
      },
    ],
  };
}

export async function suggestFollowup(input: SuggestFollowupInput) {
  return defaultSuggestedFollowupReview.suggestFollowup(input);
}

export async function listSuggestedFollowupReviews(input: ListSuggestedFollowupReviewsInput) {
  return defaultSuggestedFollowupReview.listSuggestedFollowupReviews(input);
}

export async function getSuggestedFollowupReview(input: FollowupActionInput) {
  return defaultSuggestedFollowupReview.getSuggestedFollowupReview(input);
}

export async function acceptSuggestedFollowup(input: AcceptSuggestedFollowupInput) {
  return defaultSuggestedFollowupReview.acceptSuggestedFollowup(input);
}

export async function editSuggestedFollowup(input: EditSuggestedFollowupInput) {
  return defaultSuggestedFollowupReview.editSuggestedFollowup(input);
}

export async function dismissSuggestedFollowup(input: FollowupActionInput) {
  return defaultSuggestedFollowupReview.dismissSuggestedFollowup(input);
}
