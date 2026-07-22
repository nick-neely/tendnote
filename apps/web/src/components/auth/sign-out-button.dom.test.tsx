// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { disableCurrentReminderInstallationAction, push, refresh, signOut } = vi.hoisted(() => ({
  disableCurrentReminderInstallationAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth/client", () => ({ signOut }));
vi.mock("@/app/actions/reminders", () => ({ disableCurrentReminderInstallationAction }));

import { SignOutButton } from "./sign-out-button";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("tendnote.reminder-installation-id", "browser-installation-1");
  disableCurrentReminderInstallationAction.mockResolvedValue({ ok: true });
  signOut.mockResolvedValue(undefined);
});

it("disables the current reminder installation before ending the session", async () => {
  const user = userEvent.setup();
  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  expect(disableCurrentReminderInstallationAction).toHaveBeenCalledWith({
    clientInstallationId: "browser-installation-1",
    reason: "sign_out",
  });
  expect(disableCurrentReminderInstallationAction.mock.invocationCallOrder[0]).toBeLessThan(
    signOut.mock.invocationCallOrder[0] ?? 0,
  );
});

it("keeps the session active when reminder disablement cannot be confirmed", async () => {
  const user = userEvent.setup();
  disableCurrentReminderInstallationAction.mockRejectedValue(new Error("network unavailable"));
  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Sign out" }));

  expect(
    await screen.findByText("Tendnote couldn't turn reminders off before sign-out. Try again."),
  ).toBeTruthy();
  expect(signOut).not.toHaveBeenCalled();
});
