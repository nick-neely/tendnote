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
import { createHouseholdAuthorizationProver } from "./households/authorization";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
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
const householdRecordProver = createHouseholdAuthorizationProver(createDrizzleHouseholdStore());

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

async function loadSavedItemReminderRecord(input: {
  ownerUserId: string;
  recordId: string;
}): Promise<ReminderRecord | null> {
  const item = await savedItemStore.getSavedItem({
    ownerUserId: input.ownerUserId,
    savedItemId: input.recordId,
  });
  if (!item) return null;
  const sensitivity = await reminderSourceSensitivity({
    ownerUserId: input.ownerUserId,
    sourceRecordId: item.sourceRecordId,
    getSourceRecord: sourceRecordStore.getSourceRecord,
  });
  return {
    id: item.id,
    kind: "saved_item",
    ownerUserId: item.ownerUserId,
    title: item.title,
    status: item.status,
    occursAt: item.bringBackAt,
    timeSemantics: reminderTimeSemanticsForRecordKind("saved_item"),
    recurrence: null,
    sensitivity,
    scope: item.scope,
    personId: null,
  };
}

/**
 * Loads the Action behind a reminder for the *subscribing* member, who is no
 * longer necessarily its owner.
 *
 * The owner-keyed read still runs first — it is the common private case, and the
 * only path that reaches a review-gated row — but a household-native record is
 * never served from it, because its `ownerUserId` is a storage key and honouring
 * it here would keep alerting a member who has left the household about the
 * household's chores (ADR 0214). Everything else falls through to the
 * scope-visible read, which requires current active membership, so a departed
 * member's record simply stops existing for them and their pending intent is
 * superseded on the next reconciliation.
 */
async function loadActionReminderRecord(input: {
  ownerUserId: string;
  recordId: string;
  requestedKind: "general_action" | "routine";
}): Promise<ReminderRecord | null> {
  const owned = await actionStore.getGeneralAction({
    ownerUserId: input.ownerUserId,
    generalActionId: input.recordId,
  });
  const action =
    owned?.ownership === "member_owned"
      ? owned
      : await actionStore.getVisibleGeneralAction({
          callerUserId: input.ownerUserId,
          generalActionId: input.recordId,
        });
  if (!action) return null;
  const kind = action.recurrence ? "routine" : "general_action";
  if (kind !== input.requestedKind) return null;
  // Sensitivity travels with the source record, which is the *action owner's*,
  // so it is resolved against them rather than against the subscriber. A source
  // the subscriber cannot read resolves to `restricted`, which is the
  // fail-closed answer and keeps its content out of an ambient alert.
  const sensitivity = await reminderSourceSensitivity({
    ownerUserId: action.ownerUserId,
    sourceRecordId: action.sourceRecordId,
    getSourceRecord: sourceRecordStore.getSourceRecord,
  });
  return {
    id: action.id,
    kind,
    ownerUserId: action.ownerUserId,
    ownership: action.ownership,
    householdId: action.householdId,
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

/**
 * Whether a member may hold their own Reminder Schedule for a record.
 *
 * `reminder_schedules` is keyed on the subscribing member and the record, so
 * several members can each be reminded about one shared Routine and both
 * partners can hear about bin day. What the key cannot decide is whether a given
 * member is *entitled* to one, and that is deliberately not owner-equality any
 * more: it is the Household Authorization Proof, asked for `progress`, the same
 * authority that lets a member complete the record they are asking to be
 * reminded about (ADR 0203, ADR 0219).
 *
 * Nothing here enrolls anybody. This authorizes a member's own explicit choice
 * about their own devices; no other member's action ever reaches it.
 */
async function authorizeReminderSubscription(input: {
  subscriberUserId: string;
  record: ReminderRecord;
}): Promise<boolean> {
  if (input.record.kind !== "general_action" && input.record.kind !== "routine") {
    return input.record.ownerUserId === input.subscriberUserId;
  }
  const proof = await householdRecordProver.proveRecordAccess({
    callerUserId: input.subscriberUserId,
    operation: "progress",
    record: {
      kind: "general_action",
      id: input.record.id,
      ownerUserId: input.record.ownerUserId,
      scope: input.record.scope,
      householdId: input.record.householdId ?? null,
      ownership: input.record.ownership ?? "member_owned",
    },
  });
  return proof.authorized;
}

export const reminderService = createReminderService({
  store: reminderStore,
  authorizeSubscription: authorizeReminderSubscription,
  async loadReminderRecord(input) {
    if (input.recordKind === "follow_up") {
      return loadFollowupReminderRecord({
        ownerUserId: input.ownerUserId,
        recordId: input.recordId,
      });
    }
    if (input.recordKind === "saved_item") {
      return loadSavedItemReminderRecord({
        ownerUserId: input.ownerUserId,
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
export const reconcileReminderRecordForSubscribers =
  reminderService.reconcileReminderRecordForSubscribers;
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
