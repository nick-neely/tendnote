import { zonedWallTimeToUtc } from "@tendnote/domain/brief-schedules";
import {
  reminderPushSubscriptionSchema,
  reminderScheduleChoiceSchema,
} from "@tendnote/domain/reminders";
import { createReminderDispatcher } from "./dispatch";
import type { ReminderGeneralAction, ReminderStore } from "./types";

const HOUR_MS = 60 * 60 * 1_000;

export function createReminderService(input: {
  store: ReminderStore;
  loadGeneralAction: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<ReminderGeneralAction | null>;
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
    const deliveryJobs = [];
    for (const installation of values.installations) {
      const result = await input.store.upsertDeliveryJob({
        ownerUserId: values.ownerUserId,
        occurrenceIntent: values.occurrenceIntent,
        installationId: installation.id,
        now: values.now,
      });
      deliveryJobs.push(result.job);
      if (result.changed) {
        await input.scheduleDelivery?.({
          ownerUserId: values.ownerUserId,
          jobId: result.job.id,
          nextAttemptAt: result.job.nextAttemptAt,
        });
      }
      if (result.created) {
        await input.store.appendAuditEntry({
          ownerUserId: values.ownerUserId,
          action: "reminder.delivery_intent_created",
          entityId: result.job.id,
          metadata: {
            installationId: installation.id,
            occurrenceKey: result.job.occurrenceKey,
            intendedAt: result.job.intendedAt.toISOString(),
          },
          createdAt: values.now,
        });
      }
    }
    return deliveryJobs;
  }

  return {
    async clearGeneralActionReminder(values: {
      ownerUserId: string;
      generalActionId: string;
      now: Date;
    }) {
      await input.store.deleteSchedule(values);
      return { cleared: true as const };
    },

    async saveGeneralActionReminder(values: {
      ownerUserId: string;
      generalActionId: string;
      clientInstallationId: string;
      timeZone: string;
      schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
      now: Date;
    }) {
      const action = await input.loadGeneralAction(values);
      if (
        !action ||
        action.ownerUserId !== values.ownerUserId ||
        action.status !== "open" ||
        !action.dueAt ||
        action.recurrence !== null
      ) {
        throw new Error("Only an owner's open dated one-time Action can have a reminder.");
      }
      const choice = reminderScheduleChoiceSchema.parse(values.schedule);
      const occurrenceDate = action.dueAt.toISOString().slice(0, 10);
      const occurrenceKey = `general_action:${action.id}:${occurrenceDate}`;
      const intendedAt = resolveIntendedAt({
        occurrenceDate,
        timeZone: values.timeZone,
        choice,
      });
      const schedule = await input.store.upsertSchedule({
        ownerUserId: values.ownerUserId,
        generalActionId: action.id,
        choice,
        timeZone: values.timeZone,
        occurrenceKey,
        intendedAt,
        now: values.now,
      });
      const occurrenceIntent =
        intendedAt.getTime() > values.now.getTime()
          ? await input.store.upsertOccurrenceIntent({
              ownerUserId: values.ownerUserId,
              generalActionId: action.id,
              scheduleId: schedule.id,
              occurrenceKey,
              intendedAt,
              freshUntil: new Date(intendedAt.getTime() + HOUR_MS),
              status: "pending_installation",
              now: values.now,
            })
          : null;
      if (!occurrenceIntent) {
        await input.store.supersedeOccurrenceIntents({
          ownerUserId: values.ownerUserId,
          generalActionId: action.id,
          now: values.now,
        });
      } else {
        await createInstallationJobs({
          ownerUserId: values.ownerUserId,
          occurrenceIntent,
          installations: await input.store.listEnabledInstallationsForOwner({
            ownerUserId: values.ownerUserId,
          }),
          now: values.now,
        });
      }
      const currentOptIn = await input.store.getOptInState(values);
      const shouldOffer =
        Boolean(occurrenceIntent) && (!currentOptIn || currentOptIn.state === "offered");
      const optIn = {
        state: shouldOffer ? ("offer" as const) : ("none" as const),
        clientInstallationId: values.clientInstallationId,
      };
      if (!currentOptIn && occurrenceIntent) {
        await input.store.saveOptInState({
          ownerUserId: values.ownerUserId,
          clientInstallationId: values.clientInstallationId,
          state: "offered",
          offeredAt: values.now,
          inviteAfter: null,
          updatedAt: values.now,
        });
      }
      const dueTime = resolveIntendedAt({
        occurrenceDate,
        timeZone: values.timeZone,
        choice: { kind: "relative", leadMinutes: 0 },
      });
      const nextValidChoice =
        occurrenceIntent || dueTime.getTime() <= values.now.getTime()
          ? null
          : {
              kind: "relative" as const,
              leadMinutes: 0,
              intendedAt: dueTime,
              label: "At 9:00 AM on the due date",
            };
      return { schedule, occurrenceIntent, optIn, nextValidChoice };
    },

    async registerReminderInstallation(values: {
      ownerUserId: string;
      clientInstallationId: string;
      subscription: {
        endpoint: string;
        expirationTime: number | null;
        keys: { p256dh: string; auth: string };
      };
      now: Date;
    }) {
      const optIn = await input.store.getOptInState(values);
      if (!optIn || optIn.state === "denied") {
        throw new Error("Reminder registration requires a direct opt-in invitation.");
      }
      const subscription = reminderPushSubscriptionSchema.parse(values.subscription);
      const installation = await input.store.upsertInstallation({
        ownerUserId: values.ownerUserId,
        clientInstallationId: values.clientInstallationId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime,
        now: values.now,
      });
      await input.store.saveOptInState({
        ...optIn,
        state: "registered",
        inviteAfter: null,
        updatedAt: values.now,
      });
      await input.store.appendAuditEntry({
        ownerUserId: values.ownerUserId,
        action: "reminder.installation_registered",
        entityId: installation.id,
        metadata: { previewMode: installation.previewMode },
        createdAt: values.now,
      });
      const intents = await input.store.listActiveOccurrenceIntentsForOwner({
        ownerUserId: values.ownerUserId,
      });
      const deliveryJobs = [];
      for (const occurrenceIntent of intents) {
        if (occurrenceIntent.freshUntil.getTime() <= values.now.getTime()) continue;
        const jobs = await createInstallationJobs({
          ownerUserId: values.ownerUserId,
          occurrenceIntent,
          installations: [installation],
          now: values.now,
        });
        deliveryJobs.push(...jobs);
      }
      return { installation, deliveryJobs };
    },

    async setReminderOptInDecision(values: {
      ownerUserId: string;
      clientInstallationId: string;
      decision: "postponed" | "denied";
      now: Date;
    }) {
      const current = await input.store.getOptInState(values);
      if (!current) throw new Error("Reminder opt-in has not been offered on this installation.");
      return input.store.saveOptInState({
        ...current,
        state: values.decision,
        inviteAfter:
          values.decision === "postponed"
            ? new Date(values.now.getTime() + 30 * 24 * 60 * 60_000)
            : null,
        updatedAt: values.now,
      });
    },
    dispatchReminder: createReminderDispatcher(input),
  };
}

function resolveIntendedAt(input: {
  occurrenceDate: string;
  timeZone: string;
  choice: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
}): Date {
  const [year, month, day] = input.occurrenceDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const minute =
    input.choice.kind === "exact"
      ? Number(input.choice.localTime.slice(0, 2)) * 60 + Number(input.choice.localTime.slice(3))
      : 9 * 60;
  const base = zonedWallTimeToUtc({ timeZone: input.timeZone, year, month, day, minute });
  return input.choice.kind === "relative"
    ? new Date(base.getTime() - input.choice.leadMinutes * 60_000)
    : base;
}
