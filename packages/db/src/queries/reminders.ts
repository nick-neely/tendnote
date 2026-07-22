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
import { createDrizzleSavedItemStore } from "./saved-items/drizzle-store";

export * from "./reminders/index";

const actionStore = createDrizzleGeneralActionLifecycleStore();
const followupStore = createDrizzleFollowupStore();
const outboxStore = createDrizzleBackgroundJobDeliveryStore();
const reminderStore = createDrizzleReminderStore();
const savedItemStore = createDrizzleSavedItemStore();

export const reminderService = createReminderService({
  store: reminderStore,
  async loadReminderRecord(input) {
    if (input.recordKind === "follow_up") {
      const followup = await followupStore.getFollowup({
        ownerUserId: input.ownerUserId,
        followupId: input.recordId,
      });
      return followup
        ? {
            id: followup.id,
            kind: "follow_up" as const,
            ownerUserId: followup.ownerUserId,
            title: followup.reason,
            status: followup.status,
            occursAt: followup.dueAt,
            timeSemantics: "date_only" as const,
            recurrence: null,
            sensitivity: "normal" as const,
            scope: followup.scope,
            deepLink: `/people/${followup.personId}#followup-${followup.id}`,
          }
        : null;
    }
    if (input.recordKind === "saved_item") {
      const item = await savedItemStore.getSavedItem({
        ownerUserId: input.ownerUserId,
        savedItemId: input.recordId,
      });
      return item
        ? {
            id: item.id,
            kind: "saved_item" as const,
            ownerUserId: item.ownerUserId,
            title: item.title,
            status: item.status,
            occursAt: item.bringBackAt,
            timeSemantics: "instant" as const,
            recurrence: null,
            sensitivity: "normal" as const,
            scope: item.scope,
            deepLink: `/saved-items#saved-item-${item.id}`,
          }
        : null;
    }
    const action = await actionStore.getGeneralAction({
      ownerUserId: input.ownerUserId,
      generalActionId: input.recordId,
    });
    if (!action) return null;
    const kind = action.recurrence ? ("routine" as const) : ("general_action" as const);
    return kind === input.recordKind
      ? {
          id: action.id,
          kind,
          ownerUserId: action.ownerUserId,
          title: action.title,
          status: action.status,
          occursAt: action.dueAt,
          timeSemantics: "date_only" as const,
          recurrence: action.recurrence,
          sensitivity: "normal" as const,
          scope: action.scope,
          deepLink: `/actions#action-${action.id}`,
        }
      : null;
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

export function createExplicitCaptureReminderScheduler(saveReminderImpl: typeof saveReminder) {
  return async function scheduleExplicitCaptureReminders(
    input: ExplicitCaptureReminderInput,
  ): Promise<ConversationalCaptureConfirmation | undefined> {
    const { result } = input;
    if (
      !/^\s*(?:remind\s+me|remember\s+to)\b/i.test(input.originalText) ||
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
      const target =
        outcome.kind === "general_action"
          ? {
              recordKind: outcome.generalAction.recurrence
                ? ("routine" as const)
                : ("general_action" as const),
              recordId: outcome.generalAction.id,
              schedule: outcome.generalAction.recurrence
                ? ({ kind: "relative" as const, leadMinutes: 0 } as const)
                : ({ kind: "exact" as const, localTime: "09:00" } as const),
              timeSemantics: "date_only" as const,
            }
          : outcome.kind === "followup"
            ? {
                recordKind: "follow_up" as const,
                recordId: outcome.followup.id,
                schedule: { kind: "exact" as const, localTime: "09:00" } as const,
                timeSemantics: "date_only" as const,
              }
            : outcome.kind === "saved_item" && outcome.savedItem.bringBackAt
              ? {
                  recordKind: "saved_item" as const,
                  recordId: outcome.savedItem.id,
                  schedule: { kind: "relative" as const, leadMinutes: 0 } as const,
                  timeSemantics: "instant" as const,
                }
              : null;
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
    const outcome =
      result.outcomes?.[0] ??
      (result.generalAction
        ? ({
            kind: "general_action",
            generalAction: result.generalAction,
            confirmation: result.confirmation,
            id: result.generalAction.id,
          } as const)
        : result.followup
          ? ({
              kind: "followup",
              followup: result.followup,
              confirmation: result.confirmation,
              id: result.followup.id,
            } as const)
          : result.savedItem
            ? ({
                kind: "saved_item",
                savedItem: result.savedItem,
                confirmation: result.confirmation,
                id: result.savedItem.id,
              } as const)
            : null);
    return outcome ? scheduleOutcome(outcome) : result.confirmation;
  };
}

export const scheduleExplicitCaptureReminders =
  createExplicitCaptureReminderScheduler(saveReminder);
