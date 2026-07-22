import { describe, expect, it, vi } from "vitest";
import {
  attemptReminderRegistration,
  detectReminderCapability,
  enableReminderRegistration,
  getExistingReminderInstallationId,
  getReminderInstallationId,
  reminderInstallationLabel,
  unsubscribeReminderRegistration,
} from "./reminder-registration";

describe("Reminder browser registration", () => {
  it("keeps a stable installation identity", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(getExistingReminderInstallationId(storage)).toBeNull();
    const installationId = getReminderInstallationId(storage);
    expect(getReminderInstallationId(storage)).toBe(installationId);
    expect(getExistingReminderInstallationId(storage)).toBe(installationId);
  });

  it("uses only a coarse platform-and-context label", () => {
    expect(
      reminderInstallationLabel({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
      }),
    ).toBe("iPhone Home Screen");
    expect(
      reminderInstallationLabel({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        standalone: false,
      }),
    ).toBe("Windows browser");
  });

  it("requests permission only when explicitly invoked and requires server registration", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    const register = vi.fn(async () => ({ enabled: true }));
    const subscribe = vi.fn(async () => ({
      expirationTime: null,
      toJSON: () => ({ endpoint: "https://push.test/one", keys: { p256dh: "key", auth: "auth" } }),
    }));
    expect(requestPermission).not.toHaveBeenCalled();

    const result = await enableReminderRegistration({
      publicKey: "AQAB",
      notification: { requestPermission },
      serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } } as never) },
      pushSupported: true,
      register,
    });

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "enabled" });
  });

  it("shares explicit begin, coarse labeling, registration, and decision persistence", async () => {
    const begin = vi.fn(async () => undefined);
    const decide = vi.fn(async () => undefined);
    const register = vi.fn(async () => ({ enabled: true }));
    const result = await attemptReminderRegistration({
      clientInstallationId: "browser-installation-1",
      publicKey: "AQAB",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      standalone: false,
      notification: { requestPermission: vi.fn(async () => "granted" as const) },
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            subscribe: vi.fn(async () => ({
              expirationTime: null,
              toJSON: () => ({
                endpoint: "https://push.test/shared",
                keys: { p256dh: "key", auth: "auth" },
              }),
            })),
          },
        } as never),
      },
      pushSupported: true,
      begin,
      register,
      decide,
    });

    expect(result).toEqual({ status: "enabled" });
    expect(begin).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        clientInstallationId: "browser-installation-1",
        label: "Windows browser",
      }),
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not treat platform permission as successful registration", async () => {
    const result = await enableReminderRegistration({
      publicKey: "AQAB",
      notification: {
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      },
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            subscribe: vi.fn(async () => {
              throw new Error("registration failed");
            }),
          },
        } as never),
      },
      pushSupported: true,
      register: vi.fn(),
    });
    expect(result).toEqual({ status: "registration_failed" });
  });

  it("treats a dismissed permission prompt as postponement, not denial", async () => {
    const result = await enableReminderRegistration({
      publicKey: "AQAB",
      notification: {
        requestPermission: vi.fn(async () => "default" as NotificationPermission),
      },
      serviceWorker: { ready: new Promise(() => {}) },
      pushSupported: true,
      register: vi.fn(),
    });
    expect(result).toEqual({ status: "postponed" });
  });

  it("requires Home Screen installation before offering permission on iOS", () => {
    expect(
      detectReminderCapability({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: false,
        notificationSupported: true,
        serviceWorkerSupported: true,
        pushSupported: true,
      }),
    ).toBe("install_required");
  });

  it("does not mutate opt-in state before establishing registration capability", async () => {
    const begin = vi.fn(async () => undefined);

    await expect(
      attemptReminderRegistration({
        clientInstallationId: "browser-installation-1",
        publicKey: "AQAB",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: false,
        notification: { requestPermission: vi.fn(async () => "granted" as const) },
        serviceWorker: { ready: new Promise(() => {}) },
        pushSupported: true,
        begin,
        register: vi.fn(),
        decide: vi.fn(),
      }),
    ).resolves.toEqual({ status: "install_required" });
    expect(begin).not.toHaveBeenCalled();
  });

  it("unsubscribes the current browser installation without failing sign-out cleanup", async () => {
    const unsubscribe = vi.fn(async () => true);
    const serviceWorker = {
      ready: Promise.resolve({
        pushManager: { getSubscription: vi.fn(async () => ({ unsubscribe })) },
      } as never),
    };

    await expect(unsubscribeReminderRegistration(serviceWorker)).resolves.toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(unsubscribeReminderRegistration(null)).resolves.toBe(false);
  });
});
