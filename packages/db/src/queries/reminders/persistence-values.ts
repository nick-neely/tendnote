import type { ReminderStore } from "./types";

export function reminderSchedulePersistenceValues(
  input: Parameters<ReminderStore["upsertSchedule"]>[0],
  createdAt: Date,
) {
  return {
    ownerUserId: input.ownerUserId,
    recordKind: input.recordKind,
    recordId: input.recordId,
    generalActionId: ["general_action", "routine"].includes(input.recordKind)
      ? input.recordId
      : null,
    kind: input.choice.kind,
    localTime: input.choice.kind === "exact" ? input.choice.localTime : null,
    leadMinutes: input.choice.kind === "relative" ? input.choice.leadMinutes : null,
    timeZone: input.timeZone,
    occurrenceKey: input.occurrenceKey,
    intendedAt: input.intendedAt,
    createdAt,
    updatedAt: input.now,
  };
}

export function reminderDeliveryJobPersistenceValues(
  input: Parameters<ReminderStore["upsertDeliveryJob"]>[0],
) {
  return {
    ownerUserId: input.ownerUserId,
    recordKind: input.occurrenceIntent.recordKind,
    recordId: input.occurrenceIntent.recordId,
    generalActionId: input.occurrenceIntent.generalActionId,
    scheduleId: input.occurrenceIntent.scheduleId,
    occurrenceIntentId: input.occurrenceIntent.id,
    installationId: input.installationId,
    occurrenceKey: input.occurrenceIntent.occurrenceKey,
    intendedAt: input.occurrenceIntent.intendedAt,
    freshUntil: input.occurrenceIntent.freshUntil,
    status: "pending" as const,
    outcome: null,
    attempts: 0,
    nextAttemptAt: input.occurrenceIntent.intendedAt,
    lastErrorCode: null,
    acceptedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
