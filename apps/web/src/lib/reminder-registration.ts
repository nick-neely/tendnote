const INSTALLATION_KEY = "tendnote.reminder-installation-id";

export function getReminderInstallationId(storage: Pick<Storage, "getItem" | "setItem">) {
  const current = storage.getItem(INSTALLATION_KEY);
  if (current) return current;
  const created = crypto.randomUUID();
  storage.setItem(INSTALLATION_KEY, created);
  return created;
}

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export type ReminderRegistrationOutcome =
  | { status: "enabled" }
  | { status: "denied" }
  | { status: "postponed" }
  | { status: "install_required" }
  | { status: "unsupported" }
  | { status: "registration_failed" };

/** Called only by the direct Enable button; no render/effect path may request permission. */
export async function enableReminderRegistration(input: {
  publicKey: string;
  notification: Pick<typeof Notification, "requestPermission">;
  serviceWorker: Pick<ServiceWorkerContainer, "ready">;
  pushSupported: boolean;
  register: (subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  }) => Promise<{ enabled: boolean }>;
}): Promise<ReminderRegistrationOutcome> {
  if (!input.pushSupported || !input.publicKey) return { status: "unsupported" };
  const permission = await input.notification.requestPermission();
  if (permission === "default") return { status: "postponed" };
  if (permission === "denied") return { status: "denied" };
  try {
    const registration = await input.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(input.publicKey),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return { status: "registration_failed" };
    }
    const result = await input.register({
      endpoint: json.endpoint,
      expirationTime: subscription.expirationTime,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return result.enabled ? { status: "enabled" } : { status: "registration_failed" };
  } catch {
    return { status: "registration_failed" };
  }
}

export function detectReminderCapability(input: {
  userAgent: string;
  standalone: boolean;
  notificationSupported: boolean;
  serviceWorkerSupported: boolean;
  pushSupported: boolean;
}): "supported" | "unsupported" | "install_required" {
  if (/iPad|iPhone|iPod/.test(input.userAgent) && !input.standalone) {
    return "install_required";
  }
  return input.notificationSupported && input.serviceWorkerSupported && input.pushSupported
    ? "supported"
    : "unsupported";
}
