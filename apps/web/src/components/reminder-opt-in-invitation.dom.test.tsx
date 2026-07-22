// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const {
  markReminderStandaloneContinuationAction,
  registerReminderInstallationAction,
  setReminderOptInDecisionAction,
} = vi.hoisted(() => ({
  markReminderStandaloneContinuationAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  markReminderStandaloneContinuationAction,
  registerReminderInstallationAction,
  setReminderOptInDecisionAction,
}));

import { ReminderOptInInvitation } from "./general-action-reminder";

function browserEnvironment(input: {
  permission?: NotificationPermission;
  subscribe?: () => Promise<unknown>;
  standalone?: boolean;
  userAgent?: string;
}) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: input.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: input.standalone ?? false })),
  });
  vi.stubGlobal("Notification", {
    requestPermission: vi.fn(async () => input.permission ?? "granted"),
  });
  vi.stubGlobal("PushManager", class PushManager {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          subscribe:
            input.subscribe ??
            vi.fn(async () => ({
              expirationTime: null,
              toJSON: () => ({
                endpoint: "https://push.example.test/current",
                keys: { p256dh: "p256dh", auth: "auth" },
              }),
            })),
        },
      }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = "AQAB";
  registerReminderInstallationAction.mockResolvedValue({ enabled: true });
  setReminderOptInDecisionAction.mockResolvedValue({ ok: true });
  markReminderStandaloneContinuationAction.mockResolvedValue({ ok: true });
  browserEnvironment({});
});

it("gives Safari Home Screen guidance without a fake install or permission action", async () => {
  browserEnvironment({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={vi.fn()} />,
  );

  expect(await screen.findByText(/In Safari, tap Share/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enable reminders" })).toBeNull();
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(markReminderStandaloneContinuationAction).toHaveBeenCalledWith({
    clientInstallationId: "browser-installation-1",
  });
});

it("allows a supported Android browser to enable without installation", async () => {
  const user = userEvent.setup();
  browserEnvironment({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel)" });
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={vi.fn()} />,
  );

  await user.click(await screen.findByRole("button", { name: "Enable reminders" }));
  await waitFor(() =>
    expect(registerReminderInstallationAction).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Android browser" }),
    ),
  );
  expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
});

it("keeps unsupported browsers on Today without exposing a permission action", async () => {
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(navigator, "serviceWorker");
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={vi.fn()} />,
  );

  expect(await screen.findByText(/Check Today instead/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enable reminders" })).toBeNull();
});

it("keeps Not now distinct from platform denial", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={onDismiss} />,
  );

  await user.click(await screen.findByRole("button", { name: "Not now" }));

  await waitFor(() =>
    expect(setReminderOptInDecisionAction).toHaveBeenCalledWith({
      clientInstallationId: "browser-installation-1",
      decision: "postponed",
    }),
  );
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("treats a dismissed platform prompt as postponement", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  browserEnvironment({ permission: "default" });
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={onDismiss} />,
  );

  await user.click(await screen.findByRole("button", { name: "Enable reminders" }));

  await waitFor(() =>
    expect(setReminderOptInDecisionAction).toHaveBeenCalledWith({
      clientInstallationId: "browser-installation-1",
      decision: "postponed",
    }),
  );
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("shows denial recovery guidance without contextual Check again", async () => {
  const user = userEvent.setup();
  browserEnvironment({ permission: "denied" });
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={vi.fn()} />,
  );

  await user.click(await screen.findByRole("button", { name: "Enable reminders" }));

  expect(await screen.findByText(/Notifications are blocked/)).toBeTruthy();
  expect(setReminderOptInDecisionAction).toHaveBeenCalledWith({
    clientInstallationId: "browser-installation-1",
    decision: "denied",
  });
  expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
});

it("offers Try again when permission succeeds but registration fails", async () => {
  const user = userEvent.setup();
  browserEnvironment({
    permission: "granted",
    subscribe: vi.fn(async () => {
      throw new Error("subscription failed");
    }),
  });
  render(
    <ReminderOptInInvitation clientInstallationId="browser-installation-1" onDismiss={vi.fn()} />,
  );

  await user.click(await screen.findByRole("button", { name: "Enable reminders" }));

  expect(await screen.findByText(/couldn't finish setting them up/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});
