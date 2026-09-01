import {
  type ReminderDeliveryJob,
  type ReminderInstallation,
  type ReminderInstallationSummary,
  reminderPushSubscriptionSchema,
} from "@tendnote/domain/reminders";
import { checkPushEndpointDestination, type PushEndpointCheck } from "./push-endpoint";
import type { ReminderStore } from "./types";

type InstallationJobCreator = (values: {
  ownerUserId: string;
  occurrenceIntent: Awaited<ReturnType<ReminderStore["upsertOccurrenceIntent"]>>;
  installations: ReminderInstallation[];
  now: Date;
}) => Promise<ReminderDeliveryJob[]>;

function toReminderInstallationSummary(
  installation: ReminderInstallation,
): ReminderInstallationSummary {
  return {
    id: installation.id,
    clientInstallationId: installation.clientInstallationId,
    label: installation.label,
    status: installation.status,
    previewMode: installation.previewMode,
    updatedAt: installation.updatedAt,
  };
}

export function createReminderInstallationService(input: {
  store: ReminderStore;
  createInstallationJobs: InstallationJobCreator;
  /**
   * Decides whether a subscription's endpoint is somewhere this server may
   * later POST to, unattended. Defaults to the resolving check rather than to
   * "yes", because the caller of this service is a Server Action and a Server
   * Action's arguments are whatever the caller wrote, not whatever the browser's
   * `PushManager` produced.
   */
  checkPushEndpoint?: PushEndpointCheck;
}) {
  const checkPushEndpoint = input.checkPushEndpoint ?? checkPushEndpointDestination;

  async function disableInstallation(values: {
    ownerUserId: string;
    installationId: string;
    reason: "current_installation" | "remote_revocation" | "sign_out";
    now: Date;
  }) {
    const current = await input.store.getInstallation(values);
    if (!current) throw new Error("Reminder installation not found.");
    const status = values.reason === "remote_revocation" ? "revoked" : "disabled";
    const installation = await input.store.setInstallationStatus({
      ownerUserId: values.ownerUserId,
      installationId: values.installationId,
      status,
      now: values.now,
    });
    const currentOptIn = await input.store.getOptInState({
      ownerUserId: values.ownerUserId,
      clientInstallationId: current.clientInstallationId,
    });
    await input.store.saveOptInState({
      ownerUserId: values.ownerUserId,
      clientInstallationId: current.clientInstallationId,
      state: "disabled",
      offeredAt: currentOptIn?.offeredAt ?? values.now,
      inviteAfter: null,
      standaloneContinuationExpiresAt: null,
      updatedAt: values.now,
    });
    const suppressedJobs = await input.store.suppressInstallationDeliveryJobs({
      ownerUserId: values.ownerUserId,
      installationId: values.installationId,
      now: values.now,
    });
    await Promise.all(
      suppressedJobs.map((job) =>
        input.store.appendAuditEntry({
          ownerUserId: values.ownerUserId,
          action: "reminder.delivery_suppressed",
          entityId: job.id,
          metadata: { outcome: "suppressed_revoked", installationId: values.installationId },
          createdAt: values.now,
        }),
      ),
    );
    await input.store.appendAuditEntry({
      ownerUserId: values.ownerUserId,
      action: "reminder.installation_disabled",
      entityId: values.installationId,
      metadata: { reason: values.reason, status },
      createdAt: values.now,
    });
    return { installation, suppressedJobs };
  }

  return {
    async listReminderInstallations(values: { ownerUserId: string }) {
      return (await input.store.listInstallationsForOwner(values)).map(
        toReminderInstallationSummary,
      );
    },
    async getReminderInstallationState(values: {
      ownerUserId: string;
      clientInstallationId: string;
    }) {
      const [optIn, installations] = await Promise.all([
        input.store.getOptInState(values),
        input.store.listInstallationsForOwner({ ownerUserId: values.ownerUserId }),
      ]);
      const installation = installations.find(
        (candidate) => candidate.clientInstallationId === values.clientInstallationId,
      );
      return {
        optInState: optIn?.state ?? null,
        installation: installation ? toReminderInstallationSummary(installation) : null,
      };
    },
    async registerReminderInstallation(values: {
      ownerUserId: string;
      clientInstallationId: string;
      label?: string;
      subscription: {
        endpoint: string;
        expirationTime: number | null;
        keys: { p256dh: string; auth: string };
      };
      now: Date;
    }) {
      const optIn = await input.store.getOptInState(values);
      if (!optIn || !["offered", "registered"].includes(optIn.state)) {
        throw new Error("Reminder registration requires a fresh explicit opt-in.");
      }
      const subscription = reminderPushSubscriptionSchema.parse(values.subscription);
      /**
       * A destination we can prove is off limits never reaches storage. One we
       * merely could not resolve does: a name that does not answer cannot be
       * reached, the mandatory control is at delivery - where the endpoint is
       * resolved again and the socket is pinned to what passed - and failing
       * registration on a resolver hiccup would cost a real subscriber their
       * reminders to buy nothing.
       */
      const destination = await checkPushEndpoint(subscription.endpoint);
      if (destination.status === "blocked") throw new Error(destination.reason);
      const installation = await input.store.upsertInstallation({
        ownerUserId: values.ownerUserId,
        clientInstallationId: values.clientInstallationId,
        label: values.label?.trim().slice(0, 80) || "Browser installation",
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
        standaloneContinuationExpiresAt: null,
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
        deliveryJobs.push(
          ...(await input.createInstallationJobs({
            ownerUserId: values.ownerUserId,
            occurrenceIntent,
            installations: [installation],
            now: values.now,
          })),
        );
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
        standaloneContinuationExpiresAt: null,
        updatedAt: values.now,
      });
    },
    async beginReminderInstallationOptIn(values: {
      ownerUserId: string;
      clientInstallationId: string;
      now: Date;
    }) {
      const current = await input.store.getOptInState(values);
      if (!current) {
        const activeIntents = await input.store.listActiveOccurrenceIntentsForOwner({
          ownerUserId: values.ownerUserId,
        });
        if (activeIntents.every((intent) => intent.freshUntil.getTime() <= values.now.getTime())) {
          throw new Error("Reminder opt-in requires an active owner-created reminder.");
        }
        return input.store.saveOptInState({
          ownerUserId: values.ownerUserId,
          clientInstallationId: values.clientInstallationId,
          state: "offered",
          offeredAt: values.now,
          inviteAfter: null,
          standaloneContinuationExpiresAt: null,
          updatedAt: values.now,
        });
      }
      return input.store.saveOptInState({
        ...current,
        state: "offered",
        offeredAt: values.now,
        inviteAfter: null,
        standaloneContinuationExpiresAt: null,
        updatedAt: values.now,
      });
    },
    async markReminderStandaloneContinuation(values: {
      ownerUserId: string;
      clientInstallationId: string;
      now: Date;
    }) {
      const current = await input.store.getOptInState(values);
      if (current?.state !== "offered") {
        throw new Error("A standalone continuation requires an earned Reminder Opt-In offer.");
      }
      return input.store.saveOptInState({
        ...current,
        standaloneContinuationExpiresAt: new Date(values.now.getTime() + 7 * 24 * 60 * 60_000),
        updatedAt: values.now,
      });
    },
    claimReminderStandaloneContinuation(values: {
      ownerUserId: string;
      clientInstallationId: string;
      now: Date;
    }) {
      return input.store.claimStandaloneContinuation(values);
    },
    setReminderInstallationPreviewMode(values: {
      ownerUserId: string;
      clientInstallationId: string;
      previewMode: "generic" | "detailed";
      now: Date;
    }) {
      return input.store.setInstallationPreviewMode(values);
    },
    disableReminderInstallation: disableInstallation,
    async disableCurrentReminderInstallation(values: {
      ownerUserId: string;
      clientInstallationId: string;
      reason: "current_installation" | "sign_out";
      now: Date;
    }) {
      const current = (await input.store.listInstallationsForOwner(values)).find(
        (installation) => installation.clientInstallationId === values.clientInstallationId,
      );
      if (!current) return { installation: null, suppressedJobs: [] };
      return disableInstallation({
        ownerUserId: values.ownerUserId,
        installationId: current.id,
        reason: values.reason,
        now: values.now,
      });
    },
  };
}
