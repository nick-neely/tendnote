import { createDrizzleBackgroundJobDeliveryStore } from "./background-job-deliveries";
import { createDrizzleGeneralActionLifecycleStore } from "./general-actions/drizzle-store";
import { createDrizzleReminderStore } from "./reminders/drizzle-store";
import { scheduleReminderDeliveryOutbox } from "./reminders/outbox";
import { createReminderService } from "./reminders/service";

export * from "./reminders/index";

const actionStore = createDrizzleGeneralActionLifecycleStore();
const outboxStore = createDrizzleBackgroundJobDeliveryStore();
const reminderStore = createDrizzleReminderStore();

export const reminderService = createReminderService({
  store: reminderStore,
  async loadGeneralAction(input) {
    const action = await actionStore.getGeneralAction(input);
    return action
      ? {
          ...action,
          // Phase Seven's first tracer always emits generic copy. Scope is reloaded
          // authoritatively here; visibility never enrolls another owner.
          sensitivity: "normal" as const,
        }
      : null;
  },
  scheduleDelivery: (input) => scheduleReminderDeliveryOutbox(outboxStore, input).then(() => {}),
});

export const saveGeneralActionReminder = reminderService.saveGeneralActionReminder;
export const clearGeneralActionReminder = reminderService.clearGeneralActionReminder;
export const registerReminderInstallation = reminderService.registerReminderInstallation;
export const setReminderOptInDecision = reminderService.setReminderOptInDecision;
export const dispatchReminder = reminderService.dispatchReminder;
export const listReminderSchedulesForOwner = reminderStore.listSchedulesForOwner;
