import type { ReminderDeliveryJob } from "@tendnote/domain/reminders";
import type { ReminderRecord, ReminderStore } from "./types";

export function createReminderDeliveryPlanner(input: {
  store: ReminderStore;
  scheduleDelivery?: (input: {
    ownerUserId: string;
    jobId: string;
    nextAttemptAt: Date;
  }) => Promise<void>;
}) {
  async function createInstallationJobs(values: {
    ownerUserId: string;
    occurrenceIntent: Awaited<ReturnType<ReminderStore["upsertOccurrenceIntent"]>>;
    installations: Awaited<ReturnType<ReminderStore["listEnabledInstallationsForOwner"]>>;
    now: Date;
  }) {
    const deliveryJobs = await Promise.all(
      values.installations.map(async (installation) => {
        let result: Awaited<ReturnType<ReminderStore["upsertDeliveryJob"]>>;
        try {
          result = await input.store.upsertDeliveryJob({
            ownerUserId: values.ownerUserId,
            occurrenceIntent: values.occurrenceIntent,
            installationId: installation.id,
            now: values.now,
          });
        } catch {
          await input.store
            .appendAuditEntry({
              ownerUserId: values.ownerUserId,
              action: "reminder.delivery_failed",
              entityId: installation.id,
              metadata: {
                installationId: installation.id,
                attempts: 0,
                errorCode: "delivery_intent_failed",
              },
              createdAt: values.now,
            })
            .catch(() => undefined);
          return null;
        }
        if (result.changed) {
          try {
            await input.scheduleDelivery?.({
              ownerUserId: values.ownerUserId,
              jobId: result.job.id,
              nextAttemptAt: result.job.nextAttemptAt,
            });
          } catch {
            await input.store
              .appendAuditEntry({
                ownerUserId: values.ownerUserId,
                action: "reminder.delivery_failed",
                entityId: result.job.id,
                metadata: {
                  installationId: installation.id,
                  attempts: result.job.attempts,
                  errorCode: "delivery_enqueue_failed",
                },
                createdAt: values.now,
              })
              .catch(() => undefined);
          }
        }
        if (result.created) {
          await input.store
            .appendAuditEntry({
              ownerUserId: values.ownerUserId,
              action: "reminder.delivery_intent_created",
              entityId: result.job.id,
              metadata: {
                installationId: installation.id,
                occurrenceKey: result.job.occurrenceKey,
                intendedAt: result.job.intendedAt.toISOString(),
              },
              createdAt: values.now,
            })
            .catch(() => undefined);
        }
        return result.job;
      }),
    );
    return deliveryJobs.filter((job): job is ReminderDeliveryJob => job !== null);
  }

  async function persistOccurrenceAndJobs(values: {
    ownerUserId: string;
    record: ReminderRecord;
    schedule: Awaited<ReturnType<ReminderStore["upsertSchedule"]>>;
    occurrenceKey: string;
    intendedAt: Date;
    freshUntil: Date;
    now: Date;
  }) {
    if (values.intendedAt.getTime() <= values.now.getTime()) {
      await input.store.supersedeOccurrenceIntents({
        ownerUserId: values.ownerUserId,
        recordKind: values.record.kind,
        recordId: values.record.id,
        now: values.now,
      });
      return null;
    }
    const occurrenceIntent = await input.store.upsertOccurrenceIntent({
      ownerUserId: values.ownerUserId,
      recordKind: values.record.kind,
      recordId: values.record.id,
      scheduleId: values.schedule.id,
      occurrenceKey: values.occurrenceKey,
      intendedAt: values.intendedAt,
      freshUntil: values.freshUntil,
      status: "pending_installation",
      now: values.now,
    });
    await createInstallationJobs({
      ownerUserId: values.ownerUserId,
      occurrenceIntent,
      installations: await input.store.listEnabledInstallationsForOwner({
        ownerUserId: values.ownerUserId,
      }),
      now: values.now,
    });
    return occurrenceIntent;
  }

  return { createInstallationJobs, persistOccurrenceAndJobs };
}
