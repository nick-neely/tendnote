import { describe, expect, it, vi } from "vitest";
import {
  detectReminderCapability,
  enableReminderRegistration,
  getReminderInstallationId,
} from "./reminder-registration";

describe("Reminder browser registration", () => {
  it("keeps a stable installation identity", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(getReminderInstallationId(storage)).toBe(getReminderInstallationId(storage));
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
});
