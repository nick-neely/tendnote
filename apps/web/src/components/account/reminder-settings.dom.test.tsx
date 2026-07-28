// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const {
  disableCurrentReminderInstallationAction,
  getReminderInstallationStateAction,
  revokeReminderInstallationAction,
  setReminderInstallationPreviewModeAction,
} = vi.hoisted(() => ({
  disableCurrentReminderInstallationAction: vi.fn(),
  getReminderInstallationStateAction: vi.fn(),
  revokeReminderInstallationAction: vi.fn(),
  setReminderInstallationPreviewModeAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  beginReminderInstallationOptInAction: vi.fn(),
  disableCurrentReminderInstallationAction,
  getReminderInstallationStateAction,
  registerReminderInstallationAction: vi.fn(),
  revokeReminderInstallationAction,
  setReminderInstallationPreviewModeAction,
}));

import { ReminderSettings } from "./reminder-settings";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const REMOTE_ID = "22222222-2222-4222-8222-222222222222";
const success = <T,>(view: T) => ({ ok: true as const, view });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("tendnote.reminder-installation-id", "browser-installation-1");
  getReminderInstallationStateAction.mockResolvedValue(
    success({
      optInState: "registered",
      installation: {
        id: CURRENT_ID,
        clientInstallationId: "browser-installation-1",
        label: "Windows browser",
        status: "enabled",
        previewMode: "generic",
        updatedAt: new Date("2026-07-21T15:00:00.000Z"),
      },
    }),
  );
  disableCurrentReminderInstallationAction.mockResolvedValue(success({ ok: true }));
  revokeReminderInstallationAction.mockResolvedValue(success({ ok: true }));
  setReminderInstallationPreviewModeAction.mockResolvedValue(success({ previewMode: "detailed" }));
});

const installations = [
  {
    id: CURRENT_ID,
    clientInstallationId: "browser-installation-1",
    label: "Windows browser",
    status: "enabled" as const,
    previewMode: "generic" as const,
    updatedAt: new Date("2026-07-21T15:00:00.000Z"),
  },
  {
    id: REMOTE_ID,
    clientInstallationId: "browser-installation-2",
    label: "iPhone Home Screen",
    status: "enabled" as const,
    previewMode: "generic" as const,
    updatedAt: new Date("2026-07-20T15:00:00.000Z"),
  },
];
const remoteInstallation = installations[1] as (typeof installations)[number];

it("labels current and remote installations without exposing subscription material", async () => {
  render(<ReminderSettings installations={installations} />);

  expect(await screen.findByText(/This installation/)).toBeTruthy();
  expect(screen.getByText("Windows browser")).toBeTruthy();
  expect(screen.getByText("iPhone Home Screen")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Show reminder details" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Turn off reminders on this installation" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Revoke iPhone Home Screen" })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/endpoint|p256dh|encryption/i);
});

it("changes preview privacy only for the current installation", async () => {
  const user = userEvent.setup();
  render(<ReminderSettings installations={installations} />);

  await user.click(await screen.findByRole("checkbox", { name: "Show reminder details" }));

  await waitFor(() =>
    expect(setReminderInstallationPreviewModeAction).toHaveBeenCalledWith({
      clientInstallationId: "browser-installation-1",
      previewMode: "detailed",
    }),
  );
});

it("turns off the current installation and revokes another independently", async () => {
  const user = userEvent.setup();
  render(<ReminderSettings installations={installations} />);

  await user.click(
    await screen.findByRole("button", { name: "Turn off reminders on this installation" }),
  );
  await waitFor(() =>
    expect(disableCurrentReminderInstallationAction).toHaveBeenCalledWith({
      clientInstallationId: "browser-installation-1",
      reason: "current_installation",
    }),
  );
  expect(await screen.findByRole("button", { name: "Enable again" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Revoke iPhone Home Screen" }));
  await waitFor(() =>
    expect(revokeReminderInstallationAction).toHaveBeenCalledWith({ installationId: REMOTE_ID }),
  );
});

it("shows Check again instead of a contextual prompt after permission denial", async () => {
  getReminderInstallationStateAction.mockResolvedValue(
    success({
      optInState: "denied",
      installation: null,
    }),
  );
  render(<ReminderSettings installations={[remoteInstallation]} />);

  expect(await screen.findByRole("button", { name: "Check again" })).toBeTruthy();
  expect(screen.getByText(/This installation · Blocked/)).toBeTruthy();
  expect(screen.getByText(/browser or your operating-system settings/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enable reminders" })).toBeNull();
});
