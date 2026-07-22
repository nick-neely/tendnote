import { zonedWallTimeToUtc } from "@tendnote/domain/brief-schedules";
import { type ReminderRecordKind, reminderScheduleChoiceSchema } from "@tendnote/domain/reminders";
import { createReminderDeliveryPlanner } from "./delivery-planning";
import { createReminderDispatcher } from "./dispatch";
import { createReminderInstallationService } from "./installation-service";
import { isEligibleReminderRecord, reminderOccurrenceKey } from "./policy";
import type { ReminderGeneralAction, ReminderRecord, ReminderStore } from "./types";

const HOUR_MS = 60 * 60 * 1_000;

export function createReminderService(input: {
  store: ReminderStore;
  loadGeneralAction?: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<ReminderGeneralAction | null>;
  loadReminderRecord?: (input: {
    ownerUserId: string;
    recordKind: ReminderRecordKind;
    recordId: string;
  }) => Promise<ReminderRecord | null>;
  scheduleDelivery?: (input: {
    ownerUserId: string;
    jobId: string;
    nextAttemptAt: Date;
  }) => Promise<void>;
}) {
  async function loadRecord(values: {
    ownerUserId: string;
    recordKind: ReminderRecordKind;
    recordId: string;
  }): Promise<ReminderRecord | null> {
    if (input.loadReminderRecord) return input.loadReminderRecord(values);
    if (values.recordKind !== "general_action" || !input.loadGeneralAction) return null;
    const action = await input.loadGeneralAction({
      ownerUserId: values.ownerUserId,
      generalActionId: values.recordId,
    });
    return action
      ? {
          ...action,
          kind: "general_action",
          occursAt: action.dueAt,
          timeSemantics: "date_only",
          deepLink: `/actions#action-${action.id}`,
        }
      : null;
  }

  const { createInstallationJobs, persistOccurrenceAndJobs } = createReminderDeliveryPlanner({
    store: input.store,
    scheduleDelivery: input.scheduleDelivery,
  });

  async function resolveOptInInvitation(values: {
    ownerUserId: string;
    clientInstallationId: string;
    hasOccurrenceIntent: boolean;
    now: Date;
  }) {
    const currentOptIn = await input.store.getOptInState(values);
    const postponedInvitationReady =
      currentOptIn?.state === "postponed" &&
      currentOptIn.inviteAfter !== null &&
      currentOptIn.inviteAfter.getTime() <= values.now.getTime();
    const shouldOffer =
      values.hasOccurrenceIntent &&
      (!currentOptIn || currentOptIn.state === "offered" || postponedInvitationReady);
    if (values.hasOccurrenceIntent && (!currentOptIn || postponedInvitationReady)) {
      await input.store.saveOptInState({
        ownerUserId: values.ownerUserId,
        clientInstallationId: values.clientInstallationId,
        state: "offered",
        offeredAt: values.now,
        inviteAfter: null,
        standaloneContinuationExpiresAt: null,
        updatedAt: values.now,
      });
    }
    return {
      state: shouldOffer ? ("offer" as const) : ("none" as const),
      clientInstallationId: values.clientInstallationId,
    };
  }

  async function saveReminder(values: {
    ownerUserId: string;
    recordKind: ReminderRecordKind;
    recordId: string;
    clientInstallationId: string;
    timeZone: string;
    schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
    now: Date;
  }) {
    const record = await loadRecord(values);
    if (
      !isEligibleReminderRecord(record) ||
      record.id !== values.recordId ||
      record.kind !== values.recordKind ||
      record.ownerUserId !== values.ownerUserId
    ) {
      throw new Error("Only an owner's eligible explicit time-bound record can have a reminder.");
    }
    const choice = reminderScheduleChoiceSchema.parse(values.schedule);
    if (record.kind === "routine" && choice.kind !== "relative") {
      throw new Error("A Routine Reminder Schedule must be relative to each occurrence.");
    }
    const occurrenceDate = record.occursAt.toISOString().slice(0, 10);
    const occurrenceKey = reminderOccurrenceKey(record);
    const intendedAt = resolveIntendedAt({
      occursAt: record.occursAt,
      timeSemantics: record.timeSemantics,
      occurrenceDate,
      timeZone: values.timeZone,
      choice,
    });
    const freshUntil = resolveFreshUntil({
      intendedAt,
      occurrenceDate,
      timeSemantics: record.timeSemantics,
      timeZone: values.timeZone,
    });
    const schedule = await input.store.upsertSchedule({
      ownerUserId: values.ownerUserId,
      recordKind: record.kind,
      recordId: record.id,
      choice,
      timeZone: values.timeZone,
      occurrenceKey,
      intendedAt,
      now: values.now,
    });
    const occurrenceIntent = await persistOccurrenceAndJobs({
      ownerUserId: values.ownerUserId,
      record,
      schedule,
      occurrenceKey,
      intendedAt,
      freshUntil,
      now: values.now,
    });
    const optIn = await resolveOptInInvitation({
      ownerUserId: values.ownerUserId,
      clientInstallationId: values.clientInstallationId,
      hasOccurrenceIntent: Boolean(occurrenceIntent),
      now: values.now,
    });
    const dueTime = resolveIntendedAt({
      occursAt: record.occursAt,
      timeSemantics: record.timeSemantics,
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
  }

  const dispatcher = createReminderDispatcher({
    store: input.store,
    loadReminderRecord: loadRecord,
    scheduleDelivery: input.scheduleDelivery,
  });
  const installationService = createReminderInstallationService({
    store: input.store,
    createInstallationJobs,
  });

  return {
    async resolveReminderDeepLink(values: {
      ownerUserId: string;
      recordKind: ReminderRecordKind;
      recordId: string;
    }) {
      const record = await loadRecord(values);
      return isEligibleReminderRecord(record) &&
        record.ownerUserId === values.ownerUserId &&
        record.kind === values.recordKind &&
        record.id === values.recordId
        ? record.deepLink
        : null;
    },
    ...installationService,
    async clearReminder(values: {
      ownerUserId: string;
      recordKind: ReminderRecordKind;
      recordId: string;
      now: Date;
    }) {
      await input.store.deleteSchedule(values);
      return { cleared: true as const };
    },

    async clearGeneralActionReminder(values: {
      ownerUserId: string;
      generalActionId: string;
      now: Date;
    }) {
      await input.store.deleteSchedule({
        ownerUserId: values.ownerUserId,
        recordKind: "general_action",
        recordId: values.generalActionId,
        now: values.now,
      });
      return { cleared: true as const };
    },

    saveReminder,

    async reconcileReminderRecord(values: {
      ownerUserId: string;
      recordKind: ReminderRecordKind;
      recordId: string;
      timeZone?: string;
      now: Date;
    }) {
      const [currentSchedule] = await input.store.listSchedules(values);
      if (!currentSchedule) return null;
      const record = await loadRecord(values);
      if (
        !isEligibleReminderRecord(record) ||
        record.id !== values.recordId ||
        record.kind !== values.recordKind ||
        record.ownerUserId !== values.ownerUserId
      ) {
        await input.store.supersedeOccurrenceIntents(values);
        return null;
      }
      const choice =
        currentSchedule.kind === "exact"
          ? { kind: "exact" as const, localTime: currentSchedule.localTime ?? "09:00" }
          : { kind: "relative" as const, leadMinutes: currentSchedule.leadMinutes ?? 0 };
      const occurrenceDate = record.occursAt.toISOString().slice(0, 10);
      const occurrenceKey = reminderOccurrenceKey(record);
      const intendedAt = resolveIntendedAt({
        occursAt: record.occursAt,
        timeSemantics: record.timeSemantics,
        occurrenceDate,
        timeZone: values.timeZone ?? currentSchedule.timeZone,
        choice,
      });
      const freshUntil = resolveFreshUntil({
        intendedAt,
        occurrenceDate,
        timeSemantics: record.timeSemantics,
        timeZone: values.timeZone ?? currentSchedule.timeZone,
      });
      const schedule = await input.store.upsertSchedule({
        ownerUserId: values.ownerUserId,
        recordKind: record.kind,
        recordId: record.id,
        choice,
        timeZone: values.timeZone ?? currentSchedule.timeZone,
        occurrenceKey,
        intendedAt,
        now: values.now,
      });
      if (intendedAt.getTime() <= values.now.getTime()) {
        await input.store.supersedeOccurrenceIntents(values);
        return { schedule, occurrenceIntent: null };
      }
      const occurrenceIntent = await input.store.upsertOccurrenceIntent({
        ownerUserId: values.ownerUserId,
        recordKind: record.kind,
        recordId: record.id,
        scheduleId: schedule.id,
        occurrenceKey,
        intendedAt,
        freshUntil,
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
      return { schedule, occurrenceIntent };
    },

    saveGeneralActionReminder(values: {
      ownerUserId: string;
      generalActionId: string;
      clientInstallationId: string;
      timeZone: string;
      schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
      now: Date;
    }) {
      return saveReminder({
        ...values,
        recordKind: "general_action",
        recordId: values.generalActionId,
      });
    },

    dispatchReminder: dispatcher,
  };
}

function resolveIntendedAt(input: {
  occursAt: Date;
  timeSemantics: ReminderRecord["timeSemantics"];
  occurrenceDate: string;
  timeZone: string;
  choice: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
}): Date {
  if (input.timeSemantics === "instant" && input.choice.kind === "relative") {
    return new Date(input.occursAt.getTime() - input.choice.leadMinutes * 60_000);
  }
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

function resolveFreshUntil(input: {
  intendedAt: Date;
  occurrenceDate: string;
  timeSemantics: ReminderRecord["timeSemantics"];
  timeZone: string;
}): Date {
  if (input.timeSemantics === "instant") {
    return new Date(input.intendedAt.getTime() + HOUR_MS);
  }
  const [year, month, day] = input.occurrenceDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return zonedWallTimeToUtc({
    timeZone: input.timeZone,
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    minute: 0,
  });
}
