import { randomUUID } from "node:crypto";
import type {
  ReminderDeliveryJob,
  ReminderInstallation,
  ReminderOccurrenceIntent,
  ReminderOptInState,
  ReminderSchedule,
} from "@tendnote/domain/reminders";
import {
  reminderDeliveryJobPersistenceValues,
  reminderSchedulePersistenceValues,
} from "./persistence-values";
import type { ReminderStore } from "./types";

export function createInMemoryReminderStore(): ReminderStore {
  const schedules = new Map<string, ReminderSchedule>();
  const intents = new Map<string, ReminderOccurrenceIntent[]>();
  const optIns = new Map<string, ReminderOptInState>();
  const installations = new Map<string, ReminderInstallation>();
  const deliveryJobs = new Map<string, ReminderDeliveryJob>();
  const auditEntries: Awaited<ReturnType<ReminderStore["appendAuditEntry"]>>[] = [];
  const scheduleKey = (ownerUserId: string, recordKind: string, recordId: string) =>
    `${ownerUserId}:${recordKind}:${recordId}`;

  return {
    async upsertSchedule(input) {
      const key = scheduleKey(input.ownerUserId, input.recordKind, input.recordId);
      const current = schedules.get(key);
      const schedule: ReminderSchedule = {
        id: current?.id ?? randomUUID(),
        ...reminderSchedulePersistenceValues(input, current?.createdAt ?? input.now),
      };
      schedules.set(key, schedule);
      return schedule;
    },
    async listSchedules(input) {
      const schedule = schedules.get(
        scheduleKey(input.ownerUserId, input.recordKind, input.recordId),
      );
      return schedule ? [schedule] : [];
    },
    async listSchedulesForOwner(input) {
      return [...schedules.values()].filter(
        (schedule) => schedule.ownerUserId === input.ownerUserId,
      );
    },
    async getSchedule(input) {
      return (
        [...schedules.values()].find(
          (schedule) =>
            schedule.ownerUserId === input.ownerUserId && schedule.id === input.scheduleId,
        ) ?? null
      );
    },
    async deleteSchedule(input) {
      schedules.delete(scheduleKey(input.ownerUserId, input.recordKind, input.recordId));
      const key = scheduleKey(input.ownerUserId, input.recordKind, input.recordId);
      intents.set(
        key,
        (intents.get(key) ?? []).map((intent) => ({
          ...intent,
          status: "superseded",
          updatedAt: input.now,
        })),
      );
    },
    async upsertOccurrenceIntent(input) {
      const key = scheduleKey(input.ownerUserId, input.recordKind, input.recordId);
      const history = intents.get(key) ?? [];
      const current = history.find((intent) => intent.status !== "superseded");
      if (
        current?.scheduleId === input.scheduleId &&
        current.occurrenceKey === input.occurrenceKey &&
        current.intendedAt.getTime() === input.intendedAt.getTime() &&
        current.freshUntil.getTime() === input.freshUntil.getTime() &&
        current.status === input.status
      ) {
        return current;
      }
      const supersededHistory = history.map((intent) =>
        intent.id === current?.id
          ? { ...intent, status: "superseded" as const, updatedAt: input.now }
          : intent,
      );
      const intent: ReminderOccurrenceIntent = {
        id: randomUUID(),
        ownerUserId: input.ownerUserId,
        recordKind: input.recordKind,
        recordId: input.recordId,
        generalActionId: ["general_action", "routine"].includes(input.recordKind)
          ? input.recordId
          : null,
        scheduleId: input.scheduleId,
        occurrenceKey: input.occurrenceKey,
        intendedAt: input.intendedAt,
        freshUntil: input.freshUntil,
        status: input.status,
        createdAt: input.now,
        updatedAt: input.now,
      };
      intents.set(key, [...supersededHistory, intent]);
      return intent;
    },
    async listOccurrenceIntents(input) {
      return [
        ...(intents.get(scheduleKey(input.ownerUserId, input.recordKind, input.recordId)) ?? []),
      ];
    },
    async listActiveOccurrenceIntentsForOwner(input) {
      return [...intents.values()]
        .flat()
        .filter(
          (intent) => intent.ownerUserId === input.ownerUserId && intent.status !== "superseded",
        );
    },
    async supersedeOccurrenceIntents(input) {
      const key = scheduleKey(input.ownerUserId, input.recordKind, input.recordId);
      intents.set(
        key,
        (intents.get(key) ?? []).map((intent) =>
          intent.status === "superseded"
            ? intent
            : { ...intent, status: "superseded", updatedAt: input.now },
        ),
      );
    },
    async getOptInState(input) {
      return optIns.get(`${input.ownerUserId}:${input.clientInstallationId}`) ?? null;
    },
    async saveOptInState(input) {
      optIns.set(`${input.ownerUserId}:${input.clientInstallationId}`, input);
      return input;
    },
    async upsertInstallation(input) {
      const key = `${input.ownerUserId}:${input.clientInstallationId}`;
      const current = installations.get(key);
      const installation: ReminderInstallation = {
        id: current?.id ?? randomUUID(),
        ownerUserId: input.ownerUserId,
        clientInstallationId: input.clientInstallationId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        expirationTime: input.expirationTime,
        status: "enabled",
        previewMode: current?.previewMode ?? "generic",
        createdAt: current?.createdAt ?? input.now,
        updatedAt: input.now,
      };
      installations.set(key, installation);
      return installation;
    },
    async getInstallation(input) {
      return (
        [...installations.values()].find(
          (installation) =>
            installation.ownerUserId === input.ownerUserId &&
            installation.id === input.installationId,
        ) ?? null
      );
    },
    async listEnabledInstallationsForOwner(input) {
      return [...installations.values()].filter(
        (installation) =>
          installation.ownerUserId === input.ownerUserId && installation.status === "enabled",
      );
    },
    async setInstallationStatus(input) {
      const entry = [...installations.entries()].find(
        ([, installation]) =>
          installation.ownerUserId === input.ownerUserId &&
          installation.id === input.installationId,
      );
      if (!entry) throw new Error("Reminder installation not found.");
      const updated = { ...entry[1], status: input.status, updatedAt: input.now };
      installations.set(entry[0], updated);
      return updated;
    },
    async upsertDeliveryJob(input) {
      const key = `${input.ownerUserId}:${input.occurrenceIntent.occurrenceKey}:${input.installationId}`;
      const current = deliveryJobs.get(key);
      if (current) {
        if (
          ["pending", "failed"].includes(current.status) &&
          (current.occurrenceIntentId !== input.occurrenceIntent.id ||
            current.intendedAt.getTime() !== input.occurrenceIntent.intendedAt.getTime() ||
            current.freshUntil.getTime() !== input.occurrenceIntent.freshUntil.getTime())
        ) {
          const replacement = {
            ...current,
            scheduleId: input.occurrenceIntent.scheduleId,
            occurrenceIntentId: input.occurrenceIntent.id,
            intendedAt: input.occurrenceIntent.intendedAt,
            freshUntil: input.occurrenceIntent.freshUntil,
            status: "pending" as const,
            outcome: null,
            attempts: 0,
            nextAttemptAt: input.occurrenceIntent.intendedAt,
            lastErrorCode: null,
            updatedAt: input.now,
          };
          deliveryJobs.set(key, replacement);
          return { job: replacement, created: false, changed: true };
        }
        return { job: current, created: false, changed: false };
      }
      const job: ReminderDeliveryJob = {
        id: randomUUID(),
        ...reminderDeliveryJobPersistenceValues(input),
      };
      deliveryJobs.set(key, job);
      return { job, created: true, changed: true };
    },
    async listDeliveryJobs(input) {
      return [...deliveryJobs.values()].filter((job) => job.ownerUserId === input.ownerUserId);
    },
    async getDeliveryJob(jobId) {
      return [...deliveryJobs.values()].find((job) => job.id === jobId) ?? null;
    },
    async claimDeliveryJob(input) {
      const entry = [...deliveryJobs.entries()].find(([, job]) => job.id === input.jobId);
      const job = entry?.[1];
      if (
        !entry ||
        !job ||
        !["pending", "failed"].includes(job.status) ||
        job.nextAttemptAt.getTime() > input.now.getTime()
      ) {
        return null;
      }
      const claimed = { ...job, status: "running" as const, updatedAt: input.now };
      deliveryJobs.set(entry[0], claimed);
      return claimed;
    },
    async updateDeliveryJob(input) {
      const entry = [...deliveryJobs.entries()].find(([, job]) => job.id === input.jobId);
      if (!entry) throw new Error("Reminder delivery job not found.");
      const updated: ReminderDeliveryJob = {
        ...entry[1],
        status: input.status,
        outcome: input.outcome,
        ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
        ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
        ...(input.lastErrorCode !== undefined ? { lastErrorCode: input.lastErrorCode } : {}),
        ...(input.acceptedAt !== undefined ? { acceptedAt: input.acceptedAt } : {}),
        updatedAt: input.now,
      };
      deliveryJobs.set(entry[0], updated);
      return updated;
    },
    async appendAuditEntry(input) {
      const entry = { ...input, id: randomUUID() };
      auditEntries.push(entry);
      return entry;
    },
    async listAuditEntries(input) {
      return auditEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
