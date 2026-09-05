import { describe, expect, it, vi } from "vitest";
import { createInMemoryReminderStore } from "./in-memory-store";
import {
  checkPushEndpointDestination,
  type PushEndpointCheck,
  type PushEndpointLookup,
} from "./push-endpoint";
import { createReminderService } from "./service";

const OWNER = "owner-1";
const ACTION = "11111111-1111-1111-1111-111111111111";
const SAVED_ITEM = "44444444-4444-4444-4444-444444444444";
const reminderDeepLink = (kind: string, id: string) => `/reminders/open?kind=${kind}&id=${id}`;

/**
 * These cases are about preview text and delivery bookkeeping, not endpoint
 * policy - `push-endpoint.test.ts` owns that. Resolving `push.example.test` for
 * real spends the whole lookup budget on every registration and dispatch, so
 * answer it in process and leave the rest of the destination rule intact.
 */
const resolveFixtureHost: PushEndpointLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];
const checkPushEndpoint: PushEndpointCheck = (endpoint) =>
  checkPushEndpointDestination(endpoint, { lookup: resolveFixtureHost });

describe("Reminder installation privacy and delivery", () => {
  it("continues an earned iOS offer once, on a new installation, within seven days", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-09-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "safari-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    await service.markReminderStandaloneContinuation({
      ownerUserId: OWNER,
      clientInstallationId: "safari-installation-1",
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    await expect(
      service.claimReminderStandaloneContinuation({
        ownerUserId: OWNER,
        clientInstallationId: "home-screen-installation-1",
        now: new Date("2026-07-22T15:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      clientInstallationId: "home-screen-installation-1",
      state: "offered",
    });
    await expect(
      service.claimReminderStandaloneContinuation({
        ownerUserId: OWNER,
        clientInstallationId: "unrelated-installation-1",
        now: new Date("2026-07-22T15:01:00.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("expires an unclaimed standalone continuation after seven days", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-09-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "safari-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    await service.markReminderStandaloneContinuation({
      ownerUserId: OWNER,
      clientInstallationId: "safari-installation-1",
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    await expect(
      service.claimReminderStandaloneContinuation({
        ownerUserId: OWNER,
        clientInstallationId: "home-screen-installation-1",
        now: new Date("2026-07-28T15:01:01.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("reoffers a postponed installation only after 30 days and another eligible save", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-09-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const saveAt = (now: string) =>
      service.saveGeneralActionReminder({
        ownerUserId: OWNER,
        generalActionId: ACTION,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "exact", localTime: "09:00" },
        now: new Date(now),
      });
    await saveAt("2026-07-21T15:00:00.000Z");
    await expect(
      service.beginReminderInstallationOptIn({
        ownerUserId: OWNER,
        clientInstallationId: "standalone-installation-1",
        now: new Date("2026-07-21T15:00:30.000Z"),
      }),
    ).resolves.toMatchObject({ state: "offered" });
    await service.setReminderOptInDecision({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      decision: "postponed",
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    await expect(saveAt("2026-08-20T15:00:00.000Z")).resolves.toMatchObject({
      optIn: { state: "none" },
    });
    await expect(saveAt("2026-08-21T15:02:00.000Z")).resolves.toMatchObject({
      optIn: { state: "offer" },
    });
    await expect(
      store.getOptInState({
        ownerUserId: OWNER,
        clientInstallationId: "browser-installation-1",
      }),
    ).resolves.toMatchObject({ state: "offered", offeredAt: new Date("2026-08-21T15:02:00.000Z") });
  });

  it("fans an occurrence out independently when one installation enqueue fails", async () => {
    const store = createInMemoryReminderStore();
    const scheduleDelivery = vi.fn(async () => undefined);
    const service = createReminderService({
      store,
      checkPushEndpoint,
      scheduleDelivery,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const saveFor = (clientInstallationId: string, localTime = "09:00") =>
      service.saveGeneralActionReminder({
        ownerUserId: OWNER,
        generalActionId: ACTION,
        clientInstallationId,
        timeZone: "America/Chicago",
        schedule: { kind: "exact" as const, localTime },
        now: new Date("2026-07-21T15:00:00.000Z"),
      });
    const register = (clientInstallationId: string) =>
      service.registerReminderInstallation({
        ownerUserId: OWNER,
        clientInstallationId,
        subscription: {
          endpoint: `https://push.example.test/${clientInstallationId}`,
          expirationTime: null,
          keys: { p256dh: `p256dh-${clientInstallationId}`, auth: `auth-${clientInstallationId}` },
        },
        now: new Date("2026-07-21T15:01:00.000Z"),
      });

    await saveFor("browser-installation-1");
    await register("browser-installation-1");
    await saveFor("browser-installation-2");
    await register("browser-installation-2");
    scheduleDelivery.mockClear();
    scheduleDelivery.mockRejectedValueOnce(new Error("outbox temporarily unavailable"));

    await expect(saveFor("browser-installation-1", "10:30")).resolves.toBeDefined();

    expect(scheduleDelivery).toHaveBeenCalledTimes(2);
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ intendedAt: new Date("2026-08-14T15:30:00.000Z") }),
      expect.objectContaining({ intendedAt: new Date("2026-08-14T15:30:00.000Z") }),
    ]);
  });

  it("shows only title and scheduled time after an explicit per-installation detailed-preview choice", async () => {
    const store = createInMemoryReminderStore();
    let sensitivity: "normal" | "sensitive" = "normal";
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    await service.setReminderInstallationPreviewMode({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      previewMode: "detailed",
      now: new Date("2026-07-21T15:02:00.000Z"),
    });
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId: registration.deliveryJobs[0]?.id ?? "missing",
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          title: "Replace the refrigerator water filter · 9:00 AM",
          body: "Open Tendnote to view this reminder.",
          tag: expect.any(String),
          data: {
            url: `/reminders/open?kind=general_action&id=${ACTION}`,
            recordKind: "general_action",
            recordId: ACTION,
          },
        },
      }),
    );

    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-2",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:03:00.000Z"),
    });
    const second = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-2",
      subscription: {
        endpoint: "https://push.example.test/endpoint-2",
        expirationTime: null,
        keys: { p256dh: "p256dh-2", auth: "auth-2" },
      },
      now: new Date("2026-07-21T15:04:00.000Z"),
    });
    await service.setReminderInstallationPreviewMode({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-2",
      previewMode: "detailed",
      now: new Date("2026-07-21T15:05:00.000Z"),
    });
    sensitivity = "sensitive";
    sender.mockClear();

    await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId: second.deliveryJobs[0]?.id ?? "missing",
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          title: "Tendnote reminder",
          body: "Open Tendnote to see what needs your attention.",
        }),
      }),
    );
  });

  it("turns off one installation, clears its subscription, and suppresses its pending attempt immediately", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      label: "Windows browser",
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    const result = await service.disableReminderInstallation({
      ownerUserId: OWNER,
      installationId: registration.installation.id,
      reason: "current_installation",
      now: new Date("2026-07-21T15:02:00.000Z"),
    });

    expect(result.installation).toMatchObject({
      status: "disabled",
      endpoint: null,
      p256dh: null,
      auth: null,
    });
    await expect(
      store.getOptInState({
        ownerUserId: OWNER,
        clientInstallationId: "browser-installation-1",
      }),
    ).resolves.toMatchObject({ state: "disabled" });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ status: "skipped", outcome: "suppressed_revoked" }),
    ]);

    await expect(
      service.registerReminderInstallation({
        ownerUserId: OWNER,
        clientInstallationId: "browser-installation-1",
        label: "Windows browser",
        subscription: {
          endpoint: "https://push.example.test/silent-resume",
          expirationTime: null,
          keys: { p256dh: "silent-p256dh", auth: "silent-auth" },
        },
        now: new Date("2026-07-21T15:02:30.000Z"),
      }),
    ).rejects.toThrow("fresh explicit opt-in");

    await service.beginReminderInstallationOptIn({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      now: new Date("2026-07-21T15:03:00.000Z"),
    });
    const reenabled = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      label: "Windows browser",
      subscription: {
        endpoint: "https://push.example.test/rotated-endpoint",
        expirationTime: null,
        keys: { p256dh: "rotated-p256dh", auth: "rotated-auth" },
      },
      now: new Date("2026-07-21T15:04:00.000Z"),
    });

    expect(reenabled.installation).toMatchObject({
      id: registration.installation.id,
      status: "enabled",
      endpoint: "https://push.example.test/rotated-endpoint",
    });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ status: "pending", outcome: null, attempts: 0 }),
    ]);
  });

  it("keeps the last instant-reminder retry strictly inside its original freshness window", async () => {
    const store = createInMemoryReminderStore();
    const record = {
      id: SAVED_ITEM,
      kind: "saved_item" as const,
      ownerUserId: OWNER,
      title: "Order the replacement filter",
      status: "active",
      occursAt: new Date("2026-08-14T21:00:00.000Z"),
      timeSemantics: "instant" as const,
      recurrence: null,
      sensitivity: "normal" as const,
      scope: "private" as const,
      personId: null,
    };
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadReminderRecord: vi.fn(async () => record),
    });
    const scheduled = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 60 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    expect(scheduled.occurrenceIntent?.freshUntil).toEqual(new Date("2026-08-14T21:00:00.000Z"));
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      clientInstallationId: "browser-installation-2",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 60 },
      now: new Date("2026-07-21T15:02:00.000Z"),
    });
    const staleRegistration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-2",
      subscription: {
        endpoint: "https://push.example.test/endpoint-2",
        expirationTime: null,
        keys: { p256dh: "p256dh-2", auth: "auth-2" },
      },
      now: new Date("2026-07-21T15:03:00.000Z"),
    });
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ status: "accepted" as const });
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";

    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId,
        now: new Date("2026-08-14T20:59:30.000Z"),
        sender,
      }),
    ).resolves.toEqual({
      status: "retry_scheduled",
      retryAt: new Date("2026-08-14T20:59:59.000Z"),
    });
    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId,
        now: new Date("2026-08-14T20:59:59.000Z"),
        sender,
      }),
    ).resolves.toMatchObject({ status: "accepted", displayed: false });
    expect(sender).toHaveBeenLastCalledWith(expect.objectContaining({ ttlSeconds: 1 }));
    const staleSender = vi.fn(async () => ({ status: "accepted" as const }));
    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId: staleRegistration.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T21:00:00.000Z"),
        sender: staleSender,
      }),
    ).resolves.toEqual({ status: "suppressed", reason: "suppressed_stale" });
    expect(staleSender).not.toHaveBeenCalled();
    expect(record.status).toBe("active");
  });

  it("lets another installation succeed when one endpoint is terminal", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      checkPushEndpoint,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const save = (clientInstallationId: string) =>
      service.saveGeneralActionReminder({
        ownerUserId: OWNER,
        generalActionId: ACTION,
        clientInstallationId,
        timeZone: "America/Chicago",
        schedule: { kind: "exact" as const, localTime: "09:00" },
        now: new Date("2026-07-21T15:00:00.000Z"),
      });
    const register = (clientInstallationId: string) =>
      service.registerReminderInstallation({
        ownerUserId: OWNER,
        clientInstallationId,
        subscription: {
          endpoint: `https://push.example.test/${clientInstallationId}`,
          expirationTime: null,
          keys: { p256dh: `p256dh-${clientInstallationId}`, auth: `auth-${clientInstallationId}` },
        },
        now: new Date("2026-07-21T15:01:00.000Z"),
      });
    await save("browser-installation-1");
    const first = await register("browser-installation-1");
    await save("browser-installation-2");
    const second = await register("browser-installation-2");

    await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId: first.deliveryJobs[0]?.id ?? "missing",
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender: vi.fn(async () => ({ status: "terminal" as const })),
    });
    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId: second.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T14:00:06.000Z"),
        sender: vi.fn(async () => ({ status: "accepted" as const })),
      }),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(
      store.getInstallation({
        ownerUserId: OWNER,
        installationId: first.installation.id,
      }),
    ).resolves.toMatchObject({ status: "revoked" });
    await service.beginReminderInstallationOptIn({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      now: new Date("2026-08-14T14:00:07.000Z"),
    });
    const resumed = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/browser-installation-1-rotated",
        expirationTime: null,
        keys: { p256dh: "p256dh-rotated", auth: "auth-rotated" },
      },
      now: new Date("2026-08-14T14:00:08.000Z"),
    });
    expect(resumed.installation.id).toBe(first.installation.id);
    expect(resumed.deliveryJobs[0]).toMatchObject({
      id: first.deliveryJobs[0]?.id,
      status: "pending",
      outcome: null,
    });
    await expect(
      store.getInstallation({
        ownerUserId: OWNER,
        installationId: second.installation.id,
      }),
    ).resolves.toMatchObject({ status: "enabled" });
  });
});
