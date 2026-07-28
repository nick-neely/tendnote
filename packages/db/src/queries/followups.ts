import {
  birthdayAnnualFollowupCadence,
  type Followup,
  nextBirthdayFollowupDueAt,
  type ReminderScheduleChoice,
} from "@tendnote/domain";
import { createDrizzleFollowupLifecycleStore } from "./followups/drizzle-store";
import { finalizeReminderMutation } from "./followups/finalize";
import { hydrateFollowup, hydrateFollowups } from "./followups/hydrate";
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
  SuggestedFollowupReviewResult,
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

async function hydrateLifecycleOutcome<T extends { result: Followup }>(outcome: T) {
  return {
    ...outcome,
    result: await hydrateFollowup(defaultFollowupStore, outcome.result),
  };
}

async function hydrateReviewResult<T extends SuggestedFollowupReviewResult>(result: T) {
  return {
    ...result,
    followup: await hydrateFollowup(defaultFollowupStore, result.followup),
  };
}

async function hydrateReviewResults<T extends SuggestedFollowupReviewResult[]>(results: T) {
  const followups = await hydrateFollowups(
    defaultFollowupStore,
    results.map((result) => result.followup),
  );
  return results.map((result, index) => ({
    ...result,
    followup: followups[index] ?? result.followup,
  }));
}

async function hydrateReviewOutcome<T extends { result: Followup | SuggestedFollowupReviewResult }>(
  outcome: T,
) {
  return {
    ...outcome,
    result:
      "component" in outcome.result
        ? await hydrateReviewResult(outcome.result)
        : await hydrateFollowup(defaultFollowupStore, outcome.result),
  };
}

async function reconcileFollowupReminder(followup: { id: string; ownerUserId: string }) {
  await reconcileReminderRecord({
    ownerUserId: followup.ownerUserId,
    recordKind: "follow_up",
    recordId: followup.id,
    now: new Date(),
  });
}

export async function createFollowup(input: CreateActiveFollowupInput) {
  return hydrateLifecycleOutcome(await defaultFollowupLifecycle.createFollowup(input));
}

export async function editFollowup(input: EditFollowupInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.editFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function getFollowup(input: FollowupActionInput) {
  const followup = await defaultFollowupLifecycle.getFollowup(input);
  return followup ? hydrateFollowup(defaultFollowupStore, followup) : null;
}

export async function completeFollowup(input: FollowupActionInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.completeFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function dismissFollowup(input: FollowupActionInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.dismissFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function snoozeFollowup(input: SnoozeFollowupInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.snoozeFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function reopenFollowup(input: FollowupActionInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.reopenFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function archiveFollowup(input: FollowupActionInput) {
  return finalizeReminderMutation(await defaultFollowupLifecycle.archiveFollowup(input), {
    reconcile: reconcileFollowupReminder,
    hydrate: (followup) => hydrateFollowup(defaultFollowupStore, followup),
  });
}

export async function listActiveFollowups(input: {
  ownerUserId: string;
  personId?: string;
  dueBefore?: Date;
  limit?: number;
}) {
  const summaries = await defaultFollowupLifecycle.listActiveFollowups(input);
  const followups = await hydrateFollowups(
    defaultFollowupStore,
    summaries.map((summary) => summary.followup),
  );
  return summaries.map((summary, index) => ({
    ...summary,
    followup: followups[index] ?? summary.followup,
  }));
}

export async function listFollowupsForPerson(input: { ownerUserId: string; personId: string }) {
  const followups = await defaultFollowupStore.listFollowupsForPerson(input);
  return hydrateFollowups(defaultFollowupStore, followups);
}

export async function searchFollowups(input: {
  ownerUserId: string;
  includeArchived?: boolean;
  limit?: number;
}) {
  const summaries = await defaultFollowupLifecycle.searchFollowups(input);
  const followups = await hydrateFollowups(
    defaultFollowupStore,
    summaries.map((summary) => summary.followup),
  );
  return summaries.map((summary, index) => ({
    ...summary,
    followup: followups[index] ?? summary.followup,
  }));
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
  const surfacedFollowup = await hydrateFollowup(defaultFollowupStore, followup);
  return {
    result: { followup: surfacedFollowup, reminder: reminder.result },
    affectedScopes: [
      ...reminder.affectedScopes,
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
  return hydrateReviewOutcome(await defaultSuggestedFollowupReview.suggestFollowup(input));
}

export async function listSuggestedFollowupReviews(input: ListSuggestedFollowupReviewsInput) {
  const results = await defaultSuggestedFollowupReview.listSuggestedFollowupReviews(input);
  return hydrateReviewResults(results);
}

export async function getSuggestedFollowupReview(input: FollowupActionInput) {
  const result = await defaultSuggestedFollowupReview.getSuggestedFollowupReview(input);
  return result ? hydrateReviewResult(result) : null;
}

export async function acceptSuggestedFollowup(input: AcceptSuggestedFollowupInput) {
  return hydrateReviewOutcome(await defaultSuggestedFollowupReview.acceptSuggestedFollowup(input));
}

export async function editSuggestedFollowup(input: EditSuggestedFollowupInput) {
  return hydrateReviewOutcome(await defaultSuggestedFollowupReview.editSuggestedFollowup(input));
}

export async function dismissSuggestedFollowup(input: FollowupActionInput) {
  return hydrateReviewOutcome(await defaultSuggestedFollowupReview.dismissSuggestedFollowup(input));
}
