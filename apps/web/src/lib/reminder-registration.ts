const INSTALLATION_KEY = "tendnote.reminder-installation-id";

export function isStandaloneReminderContext() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function getExistingReminderInstallationId(storage: Pick<Storage, "getItem">) {
  return storage.getItem(INSTALLATION_KEY);
}

export function getReminderInstallationId(storage: Pick<Storage, "getItem" | "setItem">) {
  const current = getExistingReminderInstallationId(storage);
  if (current) return current;
  const created = crypto.randomUUID();
  storage.setItem(INSTALLATION_KEY, created);
  return created;
}

export function reminderInstallationLabel(input: { userAgent: string; standalone: boolean }) {
  const context = input.standalone ? "Home Screen" : "browser";
  if (/iPhone|iPod/.test(input.userAgent)) return `iPhone ${context}`;
  if (/iPad/.test(input.userAgent)) return `iPad ${context}`;
  if (/Android/.test(input.userAgent)) return `Android ${context}`;
  if (/Windows/.test(input.userAgent)) return `Windows ${context}`;
  if (/Macintosh|Mac OS X/.test(input.userAgent)) return `Mac ${context}`;
  if (/Linux/.test(input.userAgent)) return `Linux ${context}`;
  return input.standalone ? "Installed app" : "Browser installation";
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

export async function attemptReminderRegistration(input: {
  clientInstallationId: string;
  publicKey: string;
  userAgent: string;
  standalone: boolean;
  notification: Pick<typeof Notification, "requestPermission"> | null;
  serviceWorker: Pick<ServiceWorkerContainer, "ready"> | null;
  pushSupported: boolean;
  begin?: () => Promise<unknown>;
  register: (input: {
    clientInstallationId: string;
    label: string;
    subscription: {
      endpoint: string;
      expirationTime: number | null;
      keys: { p256dh: string; auth: string };
    };
  }) => Promise<{ enabled: boolean }>;
  decide: (decision: "postponed" | "denied") => Promise<unknown>;
}): Promise<ReminderRegistrationOutcome> {
  const capability = detectReminderCapability({
    userAgent: input.userAgent,
    standalone: input.standalone,
    notificationSupported: input.notification !== null,
    serviceWorkerSupported: input.serviceWorker !== null,
    pushSupported: input.pushSupported,
  });
  if (capability === "unsupported" || capability === "install_required") {
    return { status: capability };
  }
  if (!input.notification || !input.serviceWorker) return { status: "unsupported" };
  await input.begin?.();
  const outcome = await enableReminderRegistration({
    publicKey: input.publicKey,
    notification: input.notification,
    serviceWorker: input.serviceWorker,
    pushSupported: input.pushSupported,
    register: (subscription) =>
      input.register({
        clientInstallationId: input.clientInstallationId,
        label: reminderInstallationLabel({
          userAgent: input.userAgent,
          standalone: input.standalone,
        }),
        subscription,
      }),
  });
  if (outcome.status === "denied" || outcome.status === "postponed") {
    await input.decide(outcome.status);
  }
  return outcome;
}

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

export async function unsubscribeReminderRegistration(
  serviceWorker: Pick<ServiceWorkerContainer, "ready"> | null,
) {
  if (!serviceWorker) return false;
  try {
    const registration = await serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? subscription.unsubscribe() : true;
  } catch {
    return false;
  }
}
