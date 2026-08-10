import type { ConversationalCaptureConfirmation } from "@tendnote/domain";
import { conversationalCaptureOutcomeConfirmationSchema } from "@tendnote/domain/conversational-capture";
import {
  formatReminderScheduleLabel,
  reminderTimeSemanticsForRecordKind,
} from "@tendnote/domain/reminders";
import {
  affectedScopesForAccount,
  affectedScopesForReminder,
  type MutationOutcome,
} from "./affected-scopes";
import { createDrizzleBackgroundJobDeliveryStore } from "./background-job-deliveries";
import type {
  CaptureOutcomeResult,
  ConversationalCaptureResult,
} from "./capture/conversational-capture/types";
import { createDrizzleFollowupStore } from "./followups/drizzle-store";
import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import { createDrizzleReminderStore } from "./reminders/drizzle-store";
import { scheduleReminderDeliveryOutbox } from "./reminders/outbox";
import { createReminderService } from "./reminders/service";
import type { ReminderRecord } from "./reminders/types";
import { createDrizzleSavedItemStore } from "./saved-items/drizzle-store";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";

export * from "./reminders/index";

const actionStore = createDrizzleGeneralActionLifecycleStore();
const followupStore = createDrizzleFollowupStore();
const outboxStore = createDrizzleBackgroundJobDeliveryStore();
const reminderStore = createDrizzleReminderStore();
const savedItemStore = createDrizzleSavedItemStore();
const sourceRecordStore = createDrizzleSourceRecordStore();

async function reminderSourceSensitivity(input: {
  ownerUserId: string;
  sourceRecordId: string | null;
  getSourceRecord: (input: {
    ownerUserId: string;
    sourceRecordId: string;
  }) => Promise<{ sensitivity: "normal" | "sensitive" | "restricted" } | null>;
}) {
  if (!input.sourceRecordId) return "normal" as const;
  return (
    (
      await input.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      })
    )?.sensitivity ?? "restricted"
  );
}

async function loadFollowupReminderRecord(input: {
  ownerUserId: string;
  recordId: string;
}): Promise<ReminderRecord | null> {
  const followup = await followupStore.getFollowup({
    ownerUserId: input.ownerUserId,
    followupId: input.recordId,
  });
  if (!followup) return null;
  const sensitivity = await reminderSourceSensitivity({
    ownerUserId: input.ownerUserId,
    sourceRecordId: followup.sourceRecordId ?? null,
    getSourceRecord: sourceRecordStore.getSourceRecord,
  });
  return {
    id: followup.id,
    kind: "follow_up",
    ownerUserId: followup.ownerUserId,
    title: followup.reason,
    status: followup.status,
    occursAt: followup.dueAt,
    timeSemantics: reminderTimeSemanticsForRecordKind("follow_up"),
    recurrence: null,
    sensitivity,
    scope: followup.scope,
    personId: followup.personId,
  };
}

/**
 * The one loader keyed by visibility rather than by ownership.
 *
 * Every active member who can currently see a Saved Item may choose their own
 * Reminder Schedule for it, and a household-native one has no owner to key on at
 * all (`docs/phase-8/household-saved-items.md`, ADR 0214). An owner-scoped read
 * here would answer null for exactly the two cases that clause exists to serve -
 * a workspace-owned item, and another member's item shared with this member -
 * and the surface would render a reminder control that silently did nothing.
 *
 * `getVisibleSavedItem` runs the Household Authorization Proof, so this asks the
 * precise question a subscription depends on: may this member see this record,
 * right now? A member who has since left, or lost the share, loads nothing - and
 * because dispatch loads through here too, their pending intents stop being
 * deliverable at the same moment, without relying on a separate sweep.
 */
async function loadSavedItemReminderRecord(input: {
  subscriberUserId: string;
  recordId: string;
}): Promise<ReminderRecord | null> {
  const item = await savedItemStore.getVisibleSavedItem({
    callerUserId: input.subscriberUserId,
    savedItemId: input.recordId,
  });
  if (!item) return null;
  // Gated on the grounding this subscriber can reach, never on what the item's
  // owner can. A reminder puts the record on someone's device, so the evidence
  // behind it has to be evidence they were actually shown; unreadable grounding
  // reads as restricted and withholds the reminder rather than guessing.
  const source = await sourceRecordStore.getVisibleSourceRecord({
    callerUserId: input.subscriberUserId,
    sourceRecordId: item.sourceRecordId,
  });
  return {
    id: item.id,
    kind: "saved_item",
    ownerUserId: item.ownerUserId,
    subscriberUserId: input.subscriberUserId,
    title: item.title,
    status: item.status,
    occursAt: item.bringBackAt,
    timeSemantics: reminderTimeSemanticsForRecordKind("saved_item"),
    recurrence: null,
    sensitivity: source?.sensitivity ?? "restricted",
    scope: item.scope,
    personId: null,
  };
}

async function loadActionReminderRecord(input: {
  ownerUserId: string;
  recordId: string;
  requestedKind: "general_action" | "routine";
}): Promise<ReminderRecord | null> {
  const action = await actionStore.getGeneralAction({
    ownerUserId: input.ownerUserId,
    generalActionId: input.recordId,
  });
  if (!action) return null;
  const kind = action.recurrence ? "routine" : "general_action";
  if (kind !== input.requestedKind) return null;
  const sensitivity = await reminderSourceSensitivity({
    ownerUserId: input.ownerUserId,
    sourceRecordId: action.sourceRecordId,
    getSourceRecord: sourceRecordStore.getSourceRecord,
  });
  return {
    id: action.id,
    kind,
    ownerUserId: action.ownerUserId,
    title: action.title,
    status: action.status,
    occursAt: action.dueAt,
    timeSemantics: reminderTimeSemanticsForRecordKind(kind),
    recurrence: action.recurrence,
    sensitivity,
    scope: action.scope,
    personId: null,
  };
}

export const reminderService = createReminderService({
  store: reminderStore,
  async loadReminderRecord(input) {
    if (input.recordKind === "follow_up") {
      return loadFollowupReminderRecord({
        ownerUserId: input.ownerUserId,
        recordId: input.recordId,
      });
    }
    if (input.recordKind === "saved_item") {
      return loadSavedItemReminderRecord({
        subscriberUserId: input.ownerUserId,
        recordId: input.recordId,
      });
    }
    return loadActionReminderRecord({
      ownerUserId: input.ownerUserId,
      recordId: input.recordId,
      requestedKind: input.recordKind,
    });
  },
  scheduleDelivery: (input) => scheduleReminderDeliveryOutbox(outboxStore, input).then(() => {}),
});

export const saveGeneralActionReminder = reminderService.saveGeneralActionReminder;
export const clearGeneralActionReminder = reminderService.clearGeneralActionReminder;

export async function reminderMutationOutcome<
  TInput extends {
    ownerUserId: string;
    recordKind: "general_action" | "saved_item" | "follow_up" | "routine";
    recordId: string;
  },
  T,
>(input: TInput, resultPromise: Promise<T>): Promise<MutationOutcome<T>> {
  return {
    result: await resultPromise,
    affectedScopes: affectedScopesForReminder(input),
  };
}

export async function accountMutationOutcome<T>(
  ownerUserId: string,
  resultPromise: Promise<T>,
): Promise<MutationOutcome<T>> {
  return {
    result: await resultPromise,
    affectedScopes: affectedScopesForAccount(ownerUserId),
  };
}

export function saveReminder(input: Parameters<typeof reminderService.saveReminder>[0]) {
  return reminderMutationOutcome(input, reminderService.saveReminder(input));
}

export function clearReminder(input: Parameters<typeof reminderService.clearReminder>[0]) {
  return reminderMutationOutcome(input, reminderService.clearReminder(input));
}

/**
 * Re-derives every subscriber's schedule for one Saved Item after it changes.
 *
 * A schedule belongs to the member who chose it, so a change to the record has
 * to be answered once per subscriber rather than once for the record. Each pass
 * reloads through the visibility-scoped loader, which means the same call both
 * regenerates the intents of members who can still see it and supersedes those
 * of members who no longer can - the spec's "changes revalidate and regenerate
 * affected subscribers' pending intents" and its revocation clause are the same
 * operation seen from two sides (`docs/phase-8/household-saved-items.md`).
 *
 * Best-effort per subscriber: the durable Saved Item write has already committed
 * and is authoritative, so one member's reminder bookkeeping failing must not
 * turn another member's successful edit into an error.
 */
export async function revalidateSavedItemReminderSubscribers(input: {
  savedItemId: string;
  now?: Date;
}): Promise<{ revalidated: number }> {
  const subscribers = await reminderStore.listScheduleSubscribers({
    recordKind: "saved_item",
    recordId: input.savedItemId,
  });
  const now = input.now ?? new Date();
  let revalidated = 0;
  for (const schedule of subscribers) {
    try {
      await reminderService.reconcileReminderRecord({
        ownerUserId: schedule.ownerUserId,
        recordKind: "saved_item",
        recordId: input.savedItemId,
        now,
      });
      revalidated += 1;
    } catch {
      // Left for the next reconcile rather than failing the member's write.
    }
  }
  return { revalidated };
}

/**
 * Drops the Saved Item schedules a member can no longer read.
 *
 * Called when household access ends - departure, removal, dissolution. Losing
 * visibility has to revoke the subscription itself and not merely its pending
 * intents: a schedule left behind would quietly resume delivering if the person
 * were ever re-admitted, which is not something they asked for twice.
 *
 * Visibility is re-read per record through the proof rather than inferred from
 * the membership change, so this stays correct for a member who left one
 * household while keeping private items of their own.
 */
export async function revokeUnreadableSavedItemReminders(input: {
  subscriberUserId: string;
  now?: Date;
}): Promise<{ revoked: number }> {
  const schedules = await reminderStore.listSchedulesForOwner({
    ownerUserId: input.subscriberUserId,
  });
  const now = input.now ?? new Date();
  let revoked = 0;
  for (const schedule of schedules) {
    if (schedule.recordKind !== "saved_item") continue;
    const stillVisible = await savedItemStore.getVisibleSavedItem({
      callerUserId: input.subscriberUserId,
      savedItemId: schedule.recordId,
    });
    if (stillVisible) continue;
    await reminderStore.supersedeOccurrenceIntents({
      ownerUserId: input.subscriberUserId,
      recordKind: "saved_item",
      recordId: schedule.recordId,
      now,
    });
    await reminderStore.deleteSchedule({
      ownerUserId: input.subscriberUserId,
      recordKind: "saved_item",
      recordId: schedule.recordId,
      now,
    });
    revoked += 1;
  }
  return { revoked };
}

export function reconcileReminderRecord(
  input: Parameters<typeof reminderService.reconcileReminderRecord>[0],
) {
  return reminderMutationOutcome(input, reminderService.reconcileReminderRecord(input));
}

export function reconcileReminderTimeZone(
  input: Parameters<typeof reminderService.reconcileReminderTimeZone>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.reconcileReminderTimeZone(input),
  );
}

export function registerReminderInstallation(
  input: Parameters<typeof reminderService.registerReminderInstallation>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.registerReminderInstallation(input),
  );
}

export function setReminderOptInDecision(
  input: Parameters<typeof reminderService.setReminderOptInDecision>[0],
) {
  return accountMutationOutcome(input.ownerUserId, reminderService.setReminderOptInDecision(input));
}

export function beginReminderInstallationOptIn(
  input: Parameters<typeof reminderService.beginReminderInstallationOptIn>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.beginReminderInstallationOptIn(input),
  );
}

export function markReminderStandaloneContinuation(
  input: Parameters<typeof reminderService.markReminderStandaloneContinuation>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.markReminderStandaloneContinuation(input),
  );
}

export function claimReminderStandaloneContinuation(
  input: Parameters<typeof reminderService.claimReminderStandaloneContinuation>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.claimReminderStandaloneContinuation(input),
  );
}

export function setReminderInstallationPreviewMode(
  input: Parameters<typeof reminderService.setReminderInstallationPreviewMode>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.setReminderInstallationPreviewMode(input),
  );
}

export function disableReminderInstallation(
  input: Parameters<typeof reminderService.disableReminderInstallation>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.disableReminderInstallation(input),
  );
}

export function disableCurrentReminderInstallation(
  input: Parameters<typeof reminderService.disableCurrentReminderInstallation>[0],
) {
  return accountMutationOutcome(
    input.ownerUserId,
    reminderService.disableCurrentReminderInstallation(input),
  );
}
export const listReminderInstallations = reminderService.listReminderInstallations;
export const getReminderInstallationState = reminderService.getReminderInstallationState;
export const resolveReminderDeepLinkTarget = reminderService.resolveReminderDeepLinkTarget;
export const dispatchReminder = reminderService.dispatchReminder;
export const listReminderSchedulesForOwner = reminderStore.listSchedulesForOwner;

type ExplicitCaptureReminderInput = {
  ownerUserId: string;
  originalText: string;
  clientInstallationId?: string;
  timeZone?: string;
  result: ConversationalCaptureResult;
  now: Date;
};

type CaptureReminderTarget = {
  recordKind: "general_action" | "follow_up" | "routine" | "saved_item";
  recordId: string;
  schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
  timeSemantics: "date_only" | "instant";
};

function captureReminderTarget(outcome: CaptureOutcomeResult): CaptureReminderTarget | null {
  if (outcome.kind === "general_action") {
    const routine = Boolean(outcome.generalAction.recurrence);
    return {
      recordKind: routine ? "routine" : "general_action",
      recordId: outcome.generalAction.id,
      schedule:
        outcome.reminderSchedule ??
        (routine ? { kind: "relative", leadMinutes: 0 } : { kind: "exact", localTime: "09:00" }),
      timeSemantics: reminderTimeSemanticsForRecordKind(routine ? "routine" : "general_action"),
    };
  }
  if (outcome.kind === "followup") {
    return {
      recordKind: "follow_up",
      recordId: outcome.followup.id,
      schedule: { kind: "exact", localTime: "09:00" },
      timeSemantics: reminderTimeSemanticsForRecordKind("follow_up"),
    };
  }
  if (outcome.kind === "saved_item" && outcome.savedItem.bringBackAt) {
    return {
      recordKind: "saved_item",
      recordId: outcome.savedItem.id,
      schedule: { kind: "relative", leadMinutes: 0 },
      timeSemantics: reminderTimeSemanticsForRecordKind("saved_item"),
    };
  }
  return null;
}

function singleCaptureOutcome(result: ConversationalCaptureResult): CaptureOutcomeResult | null {
  if (result.outcomes?.[0]) return result.outcomes[0];
  if (result.generalAction) {
    return {
      kind: "general_action",
      generalAction: result.generalAction,
      confirmation: result.confirmation as CaptureOutcomeResult["confirmation"],
      id: result.generalAction.id,
      ...(result.reminderSchedule ? { reminderSchedule: result.reminderSchedule } : {}),
    };
  }
  if (result.followup) {
    return {
      kind: "followup",
      followup: result.followup,
      confirmation: result.confirmation as CaptureOutcomeResult["confirmation"],
      id: result.followup.id,
    };
  }
  if (result.savedItem) {
    return {
      kind: "saved_item",
      savedItem: result.savedItem,
      confirmation: result.confirmation as CaptureOutcomeResult["confirmation"],
      id: result.savedItem.id,
    };
  }
  return null;
}

export function createExplicitCaptureReminderScheduler(saveReminderImpl: typeof saveReminder) {
  return async function scheduleExplicitCaptureReminders(
    input: ExplicitCaptureReminderInput,
  ): Promise<
    MutationOutcome<{
      confirmation: ConversationalCaptureConfirmation | undefined;
      reminderOptInOffered: boolean;
    }>
  > {
    const { result } = input;
    const hasScopedReminderSchedule =
      result.reminderSchedule !== undefined ||
      (result.outcomes?.some((outcome) => outcome.reminderSchedule !== undefined) ?? false);
    const blanketReminderRequested = /^\s*(?:remind\s+me|remember\s+to)\b/i.test(
      input.originalText,
    );
    if (
      (!blanketReminderRequested && !hasScopedReminderSchedule) ||
      !input.clientInstallationId ||
      !input.timeZone ||
      !result.confirmation
    ) {
      return {
        result: { confirmation: result.confirmation, reminderOptInOffered: false },
        affectedScopes: [],
      };
    }
    const clientInstallationId = input.clientInstallationId;
    const timeZone = input.timeZone;

    async function scheduleOutcome(outcome: CaptureOutcomeResult): Promise<
      MutationOutcome<{
        confirmation: CaptureOutcomeResult["confirmation"];
        reminderOptInOffered: boolean;
      }>
    > {
      if (hasScopedReminderSchedule && !outcome.reminderSchedule) {
        return {
          result: { confirmation: outcome.confirmation, reminderOptInOffered: false },
          affectedScopes: [],
        };
      }
      const target = captureReminderTarget(outcome);
      if (!target) {
        return {
          result: { confirmation: outcome.confirmation, reminderOptInOffered: false },
          affectedScopes: [],
        };
      }
      const reminder = await saveReminderImpl({
        ownerUserId: input.ownerUserId,
        ...target,
        clientInstallationId,
        timeZone,
        now: input.now,
      });
      return {
        result: {
          confirmation: conversationalCaptureOutcomeConfirmationSchema.parse({
            ...outcome.confirmation,
            interpreted: {
              ...outcome.confirmation.interpreted,
              reminderSchedule: formatReminderScheduleLabel(
                reminder.result.schedule,
                target.timeSemantics,
              ),
            },
          }),
          reminderOptInOffered: reminder.result.optIn.state === "offer",
        },
        affectedScopes: reminder.affectedScopes,
      };
    }

    if (result.confirmation.destination === "Grouped") {
      const outcomes = await Promise.all((result.outcomes ?? []).map(scheduleOutcome));
      return {
        result: {
          confirmation: {
            ...result.confirmation,
            outcomes: outcomes.map((outcome) => outcome.result.confirmation),
          },
          reminderOptInOffered: outcomes.some((outcome) => outcome.result.reminderOptInOffered),
        },
        affectedScopes: outcomes.flatMap((outcome) => outcome.affectedScopes),
      };
    }
    const outcome = singleCaptureOutcome(result);
    return outcome
      ? scheduleOutcome(outcome)
      : {
          result: { confirmation: result.confirmation, reminderOptInOffered: false },
          affectedScopes: [],
        };
  };
}

export const scheduleExplicitCaptureReminders =
  createExplicitCaptureReminderScheduler(saveReminder);
