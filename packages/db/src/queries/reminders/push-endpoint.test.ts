import { describe, expect, it, vi } from "vitest";
import { createInMemoryReminderStore } from "./in-memory-store";
import { checkPushEndpointDestination, type PushEndpointLookup } from "./push-endpoint";
import { createReminderService } from "./service";

const resolver = (...addresses: { address: string; family: 4 | 6 }[]) =>
  vi.fn(async () => addresses);

const OWNER = "owner-1";
const ACTION = "11111111-1111-1111-1111-111111111111";

function reminderServiceWith(lookup: PushEndpointLookup) {
  return createReminderService({
    store: createInMemoryReminderStore(),
    checkPushEndpoint: (endpoint) => checkPushEndpointDestination(endpoint, { lookup }),
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
}

async function registerWithEndpoint(
  service: ReturnType<typeof reminderServiceWith>,
  endpoint: string,
) {
  await service.saveGeneralActionReminder({
    ownerUserId: OWNER,
    generalActionId: ACTION,
    clientInstallationId: "browser-installation-1",
    timeZone: "America/Chicago",
    schedule: { kind: "exact", localTime: "09:00" },
    now: new Date("2026-07-21T15:00:00.000Z"),
  });
  return service.registerReminderInstallation({
    ownerUserId: OWNER,
    clientInstallationId: "browser-installation-1",
    subscription: { endpoint, expirationTime: null, keys: { p256dh: "key", auth: "auth" } },
    now: new Date("2026-07-21T15:01:00.000Z"),
  });
}

describe("Push endpoint destination", () => {
  it("admits a public host", async () => {
    await expect(
      checkPushEndpointDestination("https://fcm.googleapis.com/fcm/send/abc", {
        lookup: resolver({ address: "216.239.36.55", family: 4 }),
      }),
    ).resolves.toEqual({
      status: "allowed",
      host: "fcm.googleapis.com",
      addresses: [{ address: "216.239.36.55", family: 4 }],
    });
  });

  it("refuses a host that resolves anywhere inside the network", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fd00:ec2::254"]) {
      const family = address.includes(":") ? (6 as const) : (4 as const);
      await expect(
        checkPushEndpointDestination("https://push.attacker.example/x", {
          lookup: resolver({ address, family }),
        }),
      ).resolves.toMatchObject({ status: "blocked" });
    }
  });

  it("refuses a host whose records are only partly public", async () => {
    await expect(
      checkPushEndpointDestination("https://push.attacker.example/x", {
        lookup: resolver(
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ),
      }),
    ).resolves.toMatchObject({ status: "blocked" });
  });

  it("refuses the shape before it ever resolves", async () => {
    const lookup = resolver({ address: "93.184.216.34", family: 4 });
    await expect(
      checkPushEndpointDestination("http://push.example.com:8080/x", { lookup }),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("separates a name that cannot be resolved from one that is off limits", async () => {
    await expect(
      checkPushEndpointDestination("https://push.example.test/x", {
        lookup: vi.fn(async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        }),
      }),
    ).resolves.toMatchObject({ status: "unresolved" });
    await expect(
      checkPushEndpointDestination("https://push.example.test/x", { lookup: resolver() }),
    ).resolves.toMatchObject({ status: "unresolved" });
  });

  it("narrows to the configured providers without loosening the range check", async () => {
    const lookup = resolver({ address: "93.184.216.34", family: 4 });
    await expect(
      checkPushEndpointDestination("https://push.example.com/x", {
        lookup,
        allowlist: ["fcm.googleapis.com"],
      }),
    ).resolves.toMatchObject({ status: "blocked" });
    await expect(
      checkPushEndpointDestination("https://fcm.googleapis.com/x", {
        lookup,
        allowlist: ["fcm.googleapis.com"],
      }),
    ).resolves.toMatchObject({ status: "allowed" });
    await expect(
      checkPushEndpointDestination("https://fcm.googleapis.com/x", {
        lookup: resolver({ address: "127.0.0.1", family: 4 }),
        allowlist: ["fcm.googleapis.com"],
      }),
    ).resolves.toMatchObject({ status: "blocked" });
  });
});

describe("Reminder installation registration", () => {
  it("refuses to store an endpoint the destination check rejects", async () => {
    const service = reminderServiceWith(resolver({ address: "169.254.169.254", family: 4 }));
    await expect(registerWithEndpoint(service, "https://push.attacker.example/x")).rejects.toThrow(
      "private or reserved network",
    );
    await expect(service.listReminderInstallations({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("refuses a forged endpoint on shape alone, before any lookup", async () => {
    const lookup = resolver({ address: "93.184.216.34", family: 4 });
    const service = reminderServiceWith(lookup);
    await expect(registerWithEndpoint(service, "http://127.0.0.1:9000/x")).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("admits a registration whose host cannot be resolved right now", async () => {
    const service = reminderServiceWith(
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    await expect(
      registerWithEndpoint(service, "https://push.example.test/x"),
    ).resolves.toMatchObject({ installation: { status: "enabled" } });
  });

  it("stores an ordinary provider endpoint", async () => {
    const service = reminderServiceWith(resolver({ address: "216.239.36.55", family: 4 }));
    await expect(
      registerWithEndpoint(service, "https://fcm.googleapis.com/fcm/send/abc"),
    ).resolves.toMatchObject({ installation: { status: "enabled" } });
  });
});

describe("Reminder delivery", () => {
  it("retires an installation whose endpoint has since been repointed inside the network", async () => {
    // The rebinding case the delivery-time check exists for: the same name
    // answers publicly while it is being registered and privately by the time
    // the queue gets to it.
    let address = "216.239.36.55";
    const service = reminderServiceWith(async () => [{ address, family: 4 as const }]);
    const registration = await registerWithEndpoint(service, "https://push.attacker.example/x");
    const jobId = registration.deliveryJobs[0]?.id;
    expect(jobId, "expected a queued delivery job").toBeDefined();

    address = "169.254.169.254";
    const sender = vi.fn(async () => ({ status: "accepted" as const, providerId: null }));
    await expect(
      service.dispatchReminder({
        jobId: jobId as string,
        now: new Date("2026-09-14T14:00:05.000Z"),
        sender,
        deepLink: (recordKind, recordId) => `/reminders/open?kind=${recordKind}&id=${recordId}`,
      }),
    ).resolves.toEqual({ status: "terminal" });
    expect(sender).not.toHaveBeenCalled();
    await expect(service.listReminderInstallations({ ownerUserId: OWNER })).resolves.toMatchObject([
      { status: "revoked" },
    ]);
  });
});
