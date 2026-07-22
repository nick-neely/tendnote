// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test/dom";

const { claimReminderStandaloneContinuationAction } = vi.hoisted(() => ({
  claimReminderStandaloneContinuationAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  claimReminderStandaloneContinuationAction,
  markReminderStandaloneContinuationAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

import { StandaloneReminderContinuation } from "./standalone-reminder-continuation";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
});

it("continues the earned iOS opt-in after Tendnote opens from the Home Screen", async () => {
  window.localStorage.setItem("tendnote.reminder-installation-id", "browser-installation-1");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
  claimReminderStandaloneContinuationAction.mockResolvedValue({ claimed: true });

  render(<StandaloneReminderContinuation />);

  expect(await screen.findByText("Get this reminder on this installation?")).toBeTruthy();
  await waitFor(() =>
    expect(claimReminderStandaloneContinuationAction).toHaveBeenCalledWith({
      clientInstallationId: "browser-installation-1",
    }),
  );
});

it("creates a separate standalone identity when Safari storage is not shared", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
  claimReminderStandaloneContinuationAction.mockResolvedValue({ claimed: true });

  render(<StandaloneReminderContinuation />);

  expect(await screen.findByText("Get this reminder on this installation?")).toBeTruthy();
  expect(claimReminderStandaloneContinuationAction).toHaveBeenCalledWith({
    clientInstallationId: expect.any(String),
  });
});

it("does not continue an earned iOS offer in an unrelated desktop standalone app", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });

  render(<StandaloneReminderContinuation />);

  await waitFor(() => expect(claimReminderStandaloneContinuationAction).not.toHaveBeenCalled());
  expect(screen.queryByText("Get this reminder on this installation?")).toBeNull();
});

it("does not show a standalone offer without a live single-use continuation", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true })),
  });
  claimReminderStandaloneContinuationAction.mockResolvedValue({ claimed: false });

  render(<StandaloneReminderContinuation />);

  await waitFor(() => expect(claimReminderStandaloneContinuationAction).toHaveBeenCalledOnce());
  expect(screen.queryByText("Get this reminder on this installation?")).toBeNull();
});
