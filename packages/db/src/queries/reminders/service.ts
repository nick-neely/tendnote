import { zonedWallTimeToUtc } from "@tendnote/domain/brief-schedules";
import {
  formatReminderChoiceLabel,
  type ReminderRecordKind,
  reminderScheduleChoiceSchema,
  reminderTimeSemanticsForRecordKind,
} from "@tendnote/domain/reminders";
import { createReminderDeliveryPlanner } from "./delivery-planning";
import { createReminderDispatcher } from "./dispatch";
import { createReminderInstallationService } from "./installation-service";
import { isEligibleReminderRecord, reminderOccurrenceKey, reminderSubscriber } from "./policy";
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
  /**
   * Whether this member may hold their own Reminder Schedule for this record.
   *
   * Replaces the owner-equality test the schedule paths used to make inline. A
   * Reminder Schedule is keyed on the *subscribing* member, and Phase Eight lets
   * several members each hold their own for one shared Routine, so "is this your
   * record" is the wrong question — the right one is "can you currently see it,
   * and are you allowed to act on it", which only the Household Authorization
   * Proof can answer (ADR 0203, ADR 0219).
   *
   * Defaults to owner-equality so every family that has not opted into shared
   * subscription keeps exactly its old behaviour, and so the fail-closed answer
   * is the one you get by saying nothing.
   */
  authorizeSubscription?: (input: {
    subscriberUserId: string;
    record: ReminderRecord;
  }) => Promise<boolean>;
}) {
  const authorizeSubscription =
    input.authorizeSubscription ??
    (async (values) => reminderSubscriber(values.record) === values.subscriberUserId);

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
          timeSemantics: reminderTimeSemanticsForRecordKind("general_action"),
          personId: null,
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
      !(await authorizeSubscription({ subscriberUserId: values.ownerUserId, record }))
    ) {
      throw new Error(
        "Only an eligible explicit time-bound record you can act on can have a reminder.",
      );
    }
    if (
      record.kind === "general_action" &&
      record.status === "deferred" &&
      (await input.store.listSchedules(values)).length === 0
    ) {
      throw new Error(
        "Only an eligible explicit time-bound record you can act on can have a reminder.",
      );
    }
    const choice = reminderScheduleChoiceSchema.parse(values.schedule);
    if (record.kind === "routine" && choice.kind !== "relative") {
      throw new Error("A Routine Reminder Schedule must be relative to each occurrence.");
    }
    const occurrenceDate = record.occursAt.toISOString().slice(0, 10);
    const occurrenceKey = reminderOccurrenceKey(record);
    const effectiveChoice = resolveSetAsideAlertChoice(record, choice);
    const intendedAt = resolveIntendedAt({
      occursAt: record.occursAt,
      timeSemantics: record.timeSemantics,
      occurrenceDate,
      timeZone: values.timeZone,
      choice: effectiveChoice,
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
      choice: effectiveChoice,
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
            label: formatReminderChoiceLabel(
              { kind: "relative", leadMinutes: 0 },
              record.timeSemantics,
            ),
          };
    return { schedule, occurrenceIntent, optIn, nextValidChoice };
  }

  const dispatcher = createReminderDispatcher({
    store: input.store,
    loadReminderRecord: loadRecord,
    scheduleDelivery: input.scheduleDelivery,
    authorizeSubscription,
  });
  const installationService = createReminderInstallationService({
    store: input.store,
    createInstallationJobs,
  });

  async function reconcileReminderRecord(values: {
    ownerUserId: string;
    recordKind: ReminderRecordKind;
    recordId: string;
    timeZone?: string;
    now: Date;
  }) {
    const [currentSchedule] = await input.store.listSchedules(values);
    if (!currentSchedule) return null;
    const record = await loadRecord(values);
    // Re-decided here, not just at save time. A member who has left the household
    // still holds a schedule row until this runs, and the point of reconciliation
    // is that their pending intent is superseded rather than delivered — no alert
    // may arrive about a record they can no longer see.
    if (
      !isEligibleReminderRecord(record) ||
      record.id !== values.recordId ||
      record.kind !== values.recordKind ||
      !(await authorizeSubscription({ subscriberUserId: values.ownerUserId, record }))
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
    const timeZone = values.timeZone ?? currentSchedule.timeZone;
    const effectiveChoice = resolveSetAsideAlertChoice(record, choice);
    const intendedAt = resolveIntendedAt({
      occursAt: record.occursAt,
      timeSemantics: record.timeSemantics,
      occurrenceDate,
      timeZone,
      choice: effectiveChoice,
    });
    const freshUntil = resolveFreshUntil({
      intendedAt,
      occurrenceDate,
      timeSemantics: record.timeSemantics,
      timeZone,
    });
    const schedule = await input.store.upsertSchedule({
      ownerUserId: values.ownerUserId,
      recordKind: record.kind,
      recordId: record.id,
      choice: effectiveChoice,
      timeZone,
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
  }

  /**
   * Invalidates and regenerates every member's pending intent for one record.
   *
   * The genuinely new Phase Eight behaviour: another member may now be the cause
   * of an invalidation. A completion, skip, pause, archive, or recurrence change
   * by any authorized member has to reach every subscriber's queued alert, not
   * only the actor's — otherwise the partner who did not press the button is
   * reminded tonight about an occurrence that no longer exists. Each subscriber
   * is reconciled on their own terms, so one member losing standing supersedes
   * only their own intent and leaves everyone else's alone.
   */
  async function reconcileReminderRecordForSubscribers(values: {
    recordKind: ReminderRecordKind;
    recordId: string;
    now: Date;
  }) {
    const subscribers = await input.store.listScheduleSubscribers({
      recordKind: values.recordKind,
      recordId: values.recordId,
    });
    return Promise.all(
      subscribers.map((subscriber) =>
        reconcileReminderRecord({
          ownerUserId: subscriber.ownerUserId,
          recordKind: values.recordKind,
          recordId: values.recordId,
          now: values.now,
        }),
      ),
    );
  }

  return {
    reconcileReminderRecordForSubscribers,

    async resolveReminderDeepLinkTarget(values: {
      ownerUserId: string;
      recordKind: ReminderRecordKind;
      recordId: string;
    }) {
      const record = await loadRecord(values);
      return isEligibleReminderRecord(record) &&
        record.kind === values.recordKind &&
        record.id === values.recordId &&
        (await authorizeSubscription({ subscriberUserId: values.ownerUserId, record }))
        ? {
            recordKind: record.kind,
            recordId: record.id,
            personId: record.personId,
          }
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

    reconcileReminderRecord,

    async reconcileReminderTimeZone(values: {
      ownerUserId: string;
      timeZone: string;
      now: Date;
      offset?: number;
      batchSize?: number;
    }) {
      const schedules = (await input.store.listSchedulesForOwner(values)).sort((left, right) =>
        `${left.recordKind}:${left.recordId}`.localeCompare(
          `${right.recordKind}:${right.recordId}`,
        ),
      );
      const batchSize = values.batchSize ?? 8;
      const offset = values.offset ?? 0;
      const batch = schedules.slice(offset, offset + batchSize);
      const outcomes = await Promise.all(
        batch.map((schedule) =>
          reconcileReminderRecord({
            ownerUserId: values.ownerUserId,
            recordKind: schedule.recordKind,
            recordId: schedule.recordId,
            timeZone: values.timeZone,
            now: values.now,
          }),
        ),
      );
      const nextOffset = offset + batch.length;
      return {
        outcomes,
        reconciled: batch.length,
        remaining: Math.max(0, schedules.length - nextOffset),
        nextOffset,
      };
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

function resolveSetAsideAlertChoice(
  record: ReminderRecord,
  choice: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number },
) {
  if (
    record.kind === "general_action" &&
    record.status === "deferred" &&
    choice.kind === "relative"
  ) {
    return { kind: "exact" as const, localTime: "09:00" };
  }
  return choice;
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
