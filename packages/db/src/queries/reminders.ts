import type { ConversationalCaptureConfirmation } from "@tendnote/domain";
import { conversationalCaptureOutcomeConfirmationSchema } from "@tendnote/domain/conversational-capture";
import { formatReminderScheduleLabel } from "@tendnote/domain/reminders";
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
    timeSemantics: "date_only",
    recurrence: null,
    sensitivity,
    scope: followup.scope,
    deepLink: `/people/${followup.personId}#followup-${followup.id}`,
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
    timeSemantics: item.bringBackTimeSemantics,
    recurrence: null,
    sensitivity,
    scope: item.scope,
    deepLink: `/saved-items#saved-item-${item.id}`,
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
    timeSemantics: "date_only",
    recurrence: action.recurrence,
    sensitivity,
    scope: action.scope,
    deepLink: `/actions#action-${action.id}`,
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
export const clearGeneralActionReminder = reminderService.clearGeneralActionReminder;
export const saveReminder = reminderService.saveReminder;
export const clearReminder = reminderService.clearReminder;
export const reconcileReminderRecord = reminderService.reconcileReminderRecord;
export const registerReminderInstallation = reminderService.registerReminderInstallation;
export const setReminderOptInDecision = reminderService.setReminderOptInDecision;
export const beginReminderInstallationOptIn = reminderService.beginReminderInstallationOptIn;
export const markReminderStandaloneContinuation =
  reminderService.markReminderStandaloneContinuation;
export const claimReminderStandaloneContinuation =
  reminderService.claimReminderStandaloneContinuation;
export const setReminderInstallationPreviewMode =
  reminderService.setReminderInstallationPreviewMode;
export const disableReminderInstallation = reminderService.disableReminderInstallation;
export const disableCurrentReminderInstallation =
  reminderService.disableCurrentReminderInstallation;
export const listReminderInstallations = reminderService.listReminderInstallations;
export const getReminderInstallationState = reminderService.getReminderInstallationState;
export const resolveReminderDeepLink = reminderService.resolveReminderDeepLink;
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
      timeSemantics: "date_only",
    };
  }
  if (outcome.kind === "followup") {
    return {
      recordKind: "follow_up",
      recordId: outcome.followup.id,
      schedule: { kind: "exact", localTime: "09:00" },
      timeSemantics: "date_only",
    };
  }
  if (outcome.kind === "saved_item" && outcome.savedItem.bringBackAt) {
    return {
      recordKind: "saved_item",
      recordId: outcome.savedItem.id,
      schedule: { kind: "relative", leadMinutes: 0 },
      timeSemantics: outcome.savedItem.bringBackTimeSemantics,
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
  ): Promise<ConversationalCaptureConfirmation | undefined> {
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
      return result.confirmation;
    }
    const clientInstallationId = input.clientInstallationId;
    const timeZone = input.timeZone;

    async function scheduleOutcome(
      outcome: CaptureOutcomeResult,
    ): Promise<CaptureOutcomeResult["confirmation"]> {
      if (hasScopedReminderSchedule && !outcome.reminderSchedule) return outcome.confirmation;
      const target = captureReminderTarget(outcome);
      if (!target) return outcome.confirmation;
      const reminder = await saveReminderImpl({
        ownerUserId: input.ownerUserId,
        ...target,
        clientInstallationId,
        timeZone,
        now: input.now,
      });
      return conversationalCaptureOutcomeConfirmationSchema.parse({
        ...outcome.confirmation,
        interpreted: {
          ...outcome.confirmation.interpreted,
          reminderSchedule: formatReminderScheduleLabel(reminder.schedule, target.timeSemantics),
        },
      });
    }

    if (result.confirmation.destination === "Grouped") {
      return {
        ...result.confirmation,
        outcomes: await Promise.all((result.outcomes ?? []).map(scheduleOutcome)),
      };
    }
    const outcome = singleCaptureOutcome(result);
    return outcome ? scheduleOutcome(outcome) : result.confirmation;
  };
}

export const scheduleExplicitCaptureReminders =
  createExplicitCaptureReminderScheduler(saveReminder);
