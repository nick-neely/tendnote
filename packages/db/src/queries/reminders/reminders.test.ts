import { describe, expect, it, vi } from "vitest";
import { createInMemoryReminderStore } from "./in-memory-store";
import { createReminderService } from "./service";

const OWNER = "owner-1";
const ACTION = "11111111-1111-1111-1111-111111111111";

describe("Reminder product function", () => {
  it("saves one visible 9:00 AM schedule for a dated Action before offering installation opt-in", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
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

    const result = await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.schedule).toMatchObject({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      kind: "exact",
      localTime: "09:00",
      timeZone: "America/Chicago",
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
    });
    expect(result.occurrenceIntent).toMatchObject({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      occurrenceKey: "general_action:11111111-1111-1111-1111-111111111111:2026-08-14",
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
      status: "pending_installation",
    });
    expect(result.optIn).toEqual({
      state: "offer",
      clientInstallationId: "browser-installation-1",
    });
    await expect(
      store.listSchedules({ ownerUserId: OWNER, generalActionId: ACTION }),
    ).resolves.toHaveLength(1);
  });

  it("does not create an immediate catch-up alert when a relative lead is already past", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-07-22T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });

    const result = await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 1_440 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.occurrenceIntent).toBeNull();
    expect(result.nextValidChoice).toEqual({
      kind: "relative",
      leadMinutes: 0,
      intendedAt: new Date("2026-07-22T14:00:00.000Z"),
      label: "At 9:00 AM on the due date",
    });
  });

  it("replaces an occurrence intent deterministically when the due day or timezone changes", async () => {
    const store = createInMemoryReminderStore();
    let dueAt = new Date("2026-08-14T00:00:00.000Z");
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const base = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      schedule: { kind: "exact" as const, localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    };

    const first = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Chicago",
    });
    dueAt = new Date("2026-08-15T00:00:00.000Z");
    const replacement = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Denver",
    });
    const retry = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Denver",
    });

    expect(replacement.schedule.id).toBe(first.schedule.id);
    expect(replacement.occurrenceIntent?.id).not.toBe(first.occurrenceIntent?.id);
    expect(replacement.occurrenceIntent).toMatchObject({
      occurrenceKey: `general_action:${ACTION}:2026-08-15`,
      intendedAt: new Date("2026-08-15T15:00:00.000Z"),
      status: "pending_installation",
    });
    expect(retry.occurrenceIntent?.id).toBe(replacement.occurrenceIntent?.id);
    await expect(
      store.listOccurrenceIntents({ ownerUserId: OWNER, generalActionId: ACTION }),
    ).resolves.toEqual([
      expect.objectContaining({ id: first.occurrenceIntent?.id, status: "superseded" }),
      expect.objectContaining({
        id: replacement.occurrenceIntent?.id,
        status: "pending_installation",
      }),
    ]);
  });

  it("replaces a pending installation job when its schedule changes for the same occurrence", async () => {
    const store = createInMemoryReminderStore();
    const scheduleDelivery = vi.fn(async () => undefined);
    const service = createReminderService({
      store,
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
    const common = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
    };
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "09:00" },
    });
    await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: common.clientInstallationId,
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "10:30" },
      now: new Date("2026-07-21T15:02:00.000Z"),
    });

    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        intendedAt: new Date("2026-08-14T15:30:00.000Z"),
        nextAttemptAt: new Date("2026-08-14T15:30:00.000Z"),
        status: "pending",
      }),
    ]);
    expect(scheduleDelivery).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextAttemptAt: new Date("2026-08-14T15:30:00.000Z") }),
    );
  });

  it("supersedes a prior future intent when an edited relative lead is already past", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-07-22T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const common = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
    };
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "09:00" },
    });
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "relative", leadMinutes: 1_440 },
    });

    await expect(
      store.listActiveOccurrenceIntentsForOwner({ ownerUserId: OWNER }),
    ).resolves.toEqual([]);
  });

  it("registers consent only with a subscription and creates one minimized occurrence-installation job", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
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
    const registration = {
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    };

    const first = await service.registerReminderInstallation(registration);
    const retry = await service.registerReminderInstallation(registration);

    expect(first.installation).toMatchObject({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      status: "enabled",
      previewMode: "generic",
    });
    expect(retry.installation.id).toBe(first.installation.id);
    expect(retry.deliveryJobs[0]?.id).toBe(first.deliveryJobs[0]?.id);
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        generalActionId: ACTION,
        installationId: first.installation.id,
        status: "pending",
        attempts: 0,
      }),
    ]);
    const audit = await store.listAuditEntries({ ownerUserId: OWNER });
    expect(audit.map((entry) => entry.action)).toEqual([
      "reminder.installation_registered",
      "reminder.delivery_intent_created",
      "reminder.installation_registered",
    ]);
    expect(JSON.stringify(audit)).not.toMatch(
      /secret-endpoint|secret-p256dh|secret-auth|refrigerator water filter/i,
    );
  });

  it("reloads authoritative state and records provider acceptance once with a generic deep link", async () => {
    const store = createInMemoryReminderStore();
    const loadGeneralAction = vi.fn(async () => ({
      id: ACTION,
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      status: "open",
      dueAt: new Date("2026-08-14T00:00:00.000Z"),
      recurrence: null,
      sensitivity: "normal" as const,
      scope: "private" as const,
    }));
    const service = createReminderService({ store, loadGeneralAction });
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
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi.fn(async () => ({ status: "accepted" as const, providerId: "push-1" }));

    const accepted = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const duplicate = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:00:06.000Z"),
      sender,
    });

    expect(loadGeneralAction).toHaveBeenLastCalledWith({
      ownerUserId: OWNER,
      generalActionId: ACTION,
    });
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith({
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      payload: {
        title: "Tendnote reminder",
        body: "Open Tendnote to see what needs your attention.",
        tag: `reminder-${jobId}`,
        data: { url: `/actions#action-${ACTION}`, generalActionId: ACTION },
      },
      ttlSeconds: 3_595,
    });
    expect(accepted).toMatchObject({ status: "accepted", displayed: false });
    expect(duplicate).toEqual({ status: "already_processed" });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "completed",
        outcome: "accepted",
        attempts: 1,
      }),
    ]);
  });

  it("suppresses a pending alert when the Action is completed before dispatch", async () => {
    const store = createInMemoryReminderStore();
    let status = "open";
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status,
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
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    status = "completed";
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    await expect(
      service.dispatchReminder({
        jobId: registration.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T14:00:05.000Z"),
        sender,
      }),
    ).resolves.toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("reloads installation consent and suppresses a denied opt-in before dispatch", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
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
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    await service.setReminderOptInDecision({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      decision: "denied",
      now: new Date("2026-07-21T15:02:00.000Z"),
    });
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    await expect(
      service.dispatchReminder({
        jobId: registration.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T14:00:05.000Z"),
        sender,
      }),
    ).resolves.toEqual({ status: "suppressed", reason: "suppressed_revoked" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("isolates a transient provider failure and retries only inside the original freshness window", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
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
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 endpoint secret-endpoint unavailable"))
      .mockResolvedValueOnce({ status: "accepted" as const });

    const failed = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const retried = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:05:05.000Z"),
      sender,
    });

    expect(failed).toEqual({
      status: "retry_scheduled",
      retryAt: new Date("2026-08-14T14:05:05.000Z"),
    });
    expect(retried).toMatchObject({ status: "accepted", displayed: false });
    expect(sender).toHaveBeenCalledTimes(2);
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "completed",
        outcome: "accepted",
        attempts: 2,
        lastErrorCode: null,
      }),
    ]);
    expect(JSON.stringify(await store.listAuditEntries({ ownerUserId: OWNER }))).not.toContain(
      "secret-endpoint",
    );
  });

  it("revokes only the terminal installation and never retries its occurrence job", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
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
      subscription: {
        endpoint: "https://push.example.test/gone",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const installation = registration.installation;
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi.fn(async () => ({ status: "terminal" as const }));

    const result = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const duplicate = await service.dispatchReminder({
      jobId,
      now: new Date("2026-08-14T14:00:06.000Z"),
      sender,
    });

    expect(result).toEqual({ status: "terminal" });
    expect(duplicate).toEqual({ status: "already_processed" });
    await expect(
      store.getInstallation({ ownerUserId: OWNER, installationId: installation.id }),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "skipped",
        outcome: "terminal_endpoint",
        attempts: 1,
      }),
    ]);
  });
});
