import type {
  ReminderDeliveryJob,
  ReminderInstallation,
  ReminderOptInState,
  ReminderSchedule,
} from "@tendnote/domain/reminders";
import { isEligibleReminderRecord, reminderOccurrenceKey } from "./policy";
import type { ReminderRecord, ReminderStore } from "./types";

export type ReminderPushSender = (input: {
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
  payload: {
    title: string;
    body: string;
    tag: string;
    data: { url: string; recordKind: ReminderDeliveryJob["recordKind"]; recordId: string };
  };
  ttlSeconds: number;
}) => Promise<{ status: "accepted"; providerId?: string | null } | { status: "terminal" }>;

type ReminderDispatcherDependencies = {
  store: ReminderStore;
  loadReminderRecord: (input: {
    ownerUserId: string;
    recordKind: ReminderDeliveryJob["recordKind"];
    recordId: string;
  }) => Promise<ReminderRecord | null>;
  scheduleDelivery?: (input: {
    ownerUserId: string;
    jobId: string;
    nextAttemptAt: Date;
  }) => Promise<void>;
};

type DispatchValues = { jobId: string; now: Date; sender: ReminderPushSender };

type DispatchContext = {
  record: ReminderRecord | null;
  schedule: ReminderSchedule | null;
  installation: ReminderInstallation | null;
  optIn: ReminderOptInState | null;
};

async function loadDispatchContext(
  input: ReminderDispatcherDependencies,
  claimed: ReminderDeliveryJob,
): Promise<DispatchContext> {
  const [record, schedule, installation] = await Promise.all([
    input.loadReminderRecord({
      ownerUserId: claimed.ownerUserId,
      recordKind: claimed.recordKind,
      recordId: claimed.recordId,
    }),
    input.store.getSchedule({
      ownerUserId: claimed.ownerUserId,
      scheduleId: claimed.scheduleId,
    }),
    input.store.getInstallation({
      ownerUserId: claimed.ownerUserId,
      installationId: claimed.installationId,
    }),
  ]);
  const optIn = installation
    ? await input.store.getOptInState({
        ownerUserId: claimed.ownerUserId,
        clientInstallationId: installation.clientInstallationId,
      })
    : null;
  return { record, schedule, installation, optIn };
}

function suppressionReason(
  claimed: ReminderDeliveryJob,
  context: DispatchContext,
  now: Date,
): "suppressed_stale" | "suppressed_revoked" | "suppressed_ineligible" | null {
  if (now.getTime() >= claimed.freshUntil.getTime()) return "suppressed_stale";
  if (context.installation?.status !== "enabled" || context.optIn?.state !== "registered") {
    return "suppressed_revoked";
  }
  const currentOccurrenceKey = isEligibleReminderRecord(context.record)
    ? reminderOccurrenceKey(context.record)
    : null;
  if (
    !context.record ||
    context.record.ownerUserId !== claimed.ownerUserId ||
    context.record.kind !== claimed.recordKind ||
    context.record.id !== claimed.recordId ||
    !isEligibleReminderRecord(context.record) ||
    currentOccurrenceKey !== claimed.occurrenceKey ||
    !context.schedule ||
    context.schedule.occurrenceKey !== claimed.occurrenceKey ||
    context.schedule.intendedAt.getTime() !== claimed.intendedAt.getTime()
  ) {
    return "suppressed_ineligible";
  }
  return null;
}

async function suppressDelivery(
  store: ReminderStore,
  claimed: ReminderDeliveryJob,
  now: Date,
  reason: "suppressed_stale" | "suppressed_revoked" | "suppressed_ineligible",
) {
  await store.updateDeliveryJob({
    jobId: claimed.id,
    now,
    status: "skipped",
    outcome: reason,
    attempts: claimed.attempts,
  });
  await store.appendAuditEntry({
    ownerUserId: claimed.ownerUserId,
    action: "reminder.delivery_suppressed",
    entityId: claimed.id,
    metadata: { outcome: reason, installationId: claimed.installationId },
    createdAt: now,
  });
  return { status: "suppressed" as const, reason };
}

async function scheduleRetry(
  input: ReminderDispatcherDependencies,
  claimed: ReminderDeliveryJob,
  now: Date,
) {
  const retryAt = new Date(Math.min(now.getTime() + 5 * 60_000, claimed.freshUntil.getTime()));
  await input.store.updateDeliveryJob({
    jobId: claimed.id,
    now,
    status: "failed",
    outcome: "transient_failure",
    attempts: claimed.attempts + 1,
    nextAttemptAt: retryAt,
    lastErrorCode: "push_temporarily_unavailable",
  });
  await input.scheduleDelivery?.({
    ownerUserId: claimed.ownerUserId,
    jobId: claimed.id,
    nextAttemptAt: retryAt,
  });
  await input.store.appendAuditEntry({
    ownerUserId: claimed.ownerUserId,
    action: "reminder.delivery_failed",
    entityId: claimed.id,
    metadata: {
      installationId: claimed.installationId,
      attempts: claimed.attempts + 1,
      errorCode: "push_temporarily_unavailable",
    },
    createdAt: now,
  });
  return { status: "retry_scheduled" as const, retryAt };
}

async function revokeTerminalInstallation(
  store: ReminderStore,
  claimed: ReminderDeliveryJob,
  now: Date,
) {
  await store.setInstallationStatus({
    ownerUserId: claimed.ownerUserId,
    installationId: claimed.installationId,
    status: "revoked",
    now,
  });
  await store.updateDeliveryJob({
    jobId: claimed.id,
    now,
    status: "skipped",
    outcome: "terminal_endpoint",
    attempts: claimed.attempts + 1,
  });
  return { status: "terminal" as const };
}

async function acceptDelivery(store: ReminderStore, claimed: ReminderDeliveryJob, now: Date) {
  await store.updateDeliveryJob({
    jobId: claimed.id,
    now,
    status: "completed",
    outcome: "accepted",
    attempts: claimed.attempts + 1,
    acceptedAt: now,
    lastErrorCode: null,
  });
  await store.appendAuditEntry({
    ownerUserId: claimed.ownerUserId,
    action: "reminder.delivery_accepted",
    entityId: claimed.id,
    metadata: {
      installationId: claimed.installationId,
      intendedAt: claimed.intendedAt.toISOString(),
      attempts: claimed.attempts + 1,
    },
    createdAt: now,
  });
  return { status: "accepted" as const, displayed: false as const };
}

export function createReminderDispatcher(input: ReminderDispatcherDependencies) {
  return async function dispatchReminder(values: DispatchValues) {
    const claimed = await input.store.claimDeliveryJob(values);
    if (!claimed) {
      const current = await input.store.getDeliveryJob(values.jobId);
      return current?.status === "completed" || current?.status === "skipped"
        ? ({ status: "already_processed" } as const)
        : ({ status: "not_ready" } as const);
    }
    const context = await loadDispatchContext(input, claimed);
    const suppression = suppressionReason(claimed, context, values.now);
    if (suppression) {
      return suppressDelivery(input.store, claimed, values.now, suppression);
    }
    if (!context.record || !context.installation) {
      throw new Error("Reminder record or installation missing after policy check.");
    }

    let result: Awaited<ReturnType<ReminderPushSender>>;
    try {
      result = await values.sender({
        subscription: {
          endpoint: context.installation.endpoint,
          expirationTime: context.installation.expirationTime,
          keys: { p256dh: context.installation.p256dh, auth: context.installation.auth },
        },
        payload: {
          title: "Tendnote reminder",
          body: "Open Tendnote to see what needs your attention.",
          tag: `reminder-${claimed.id}`,
          data: {
            url: context.record.deepLink,
            recordKind: claimed.recordKind,
            recordId: claimed.recordId,
          },
        },
        ttlSeconds: Math.max(
          0,
          Math.floor((claimed.freshUntil.getTime() - values.now.getTime()) / 1_000),
        ),
      });
    } catch {
      return scheduleRetry(input, claimed, values.now);
    }
    if (result.status === "terminal") {
      return revokeTerminalInstallation(input.store, claimed, values.now);
    }
    return acceptDelivery(input.store, claimed, values.now);
  };
}
