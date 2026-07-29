// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const createFollowupAction = vi.fn();
const saveReminderAction = vi.fn();

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("@/app/actions/followups", () => ({
  createFollowupAction: (...args: unknown[]) => createFollowupAction(...args),
}));
vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveReminderAction: (...args: unknown[]) => saveReminderAction(...args),
  setReminderOptInDecisionAction: vi.fn(),
}));

import { CreateFollowupForm } from "./person-followup-create-form";

it("does not confirm a Follow-Up reminder whose selected alert time has passed", async () => {
  const user = userEvent.setup();
  createFollowupAction.mockResolvedValue({
    ok: true,
    view: {
      id: "11111111-1111-4111-8111-111111111111",
      reason: "Check in",
      status: "open",
      dueAtISO: "2026-07-21T00:00:00.000Z",
      dueAtDate: "2026-07-21",
      dueLabel: "Jul 21",
      dueState: "upcoming",
      visibilityChoice: "only_me",
      visibilityLabel: "Only me",
    },
  });
  saveReminderAction.mockResolvedValue({
    ok: true,
    view: {
      optIn: { state: "none", clientInstallationId: "browser-installation-1" },
      nextValidChoice: {
        label: "At 9:00 AM on the due date",
        choice: { kind: "relative", leadMinutes: 0 },
      },
      schedule: {
        kind: "exact",
        localTime: "09:00",
        leadMinutes: null,
        timeZone: "America/Chicago",
        intendedAtISO: "2026-07-21T14:00:00.000Z",
      },
    },
  });
  render(
    <CreateFollowupForm
      defaultDueDate="2026-07-21"
      firstName="Maya"
      onCreate={vi.fn()}
      personId="person-1"
    />,
  );

  await user.click(screen.getByRole("button", { name: "New follow-up" }));
  await user.type(screen.getByRole("textbox", { name: "Why follow up with Maya?" }), "Check in");
  await user.click(screen.getByRole("checkbox", { name: "Remind me" }));
  await user.click(screen.getByRole("button", { name: "Add follow-up" }));

  expect(await screen.findByText(/alert time has passed/i)).toBeDefined();
  expect(screen.getByRole("button", { name: /Use At 9:00 AM on the due date/i })).toBeDefined();
  expect(screen.queryByText(/Reminder at/i)).toBeNull();
});

it("picks a household member from anywhere on their card", async () => {
  const user = userEvent.setup();
  createFollowupAction.mockResolvedValue({
    ok: true,
    view: {
      id: "11111111-1111-4111-8111-111111111111",
      reason: "Check in",
      status: "open",
      dueAtISO: "2026-07-21T00:00:00.000Z",
      dueAtDate: "2026-07-21",
      dueLabel: "Jul 21",
      dueState: "upcoming",
      visibilityChoice: "selected_members",
      visibilityLabel: "Nina",
    },
  });
  render(
    <CreateFollowupForm
      defaultDueDate="2026-07-21"
      firstName="Maya"
      onCreate={vi.fn()}
      personId="person-1"
      shareableMembers={[{ userId: "user-2", name: "Nina", email: "nina@example.com" }]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "New follow-up" }));
  await user.type(screen.getByRole("textbox", { name: "Why follow up with Maya?" }), "Check in");
  await user.click(screen.getByRole("radio", { name: /Specific people/ }));

  // The card is the hit target, not just the box - clicking the quiet email line
  // still selects the member.
  await user.click(screen.getByText("nina@example.com"));
  expect(screen.getByRole("checkbox", { name: /Nina/ }).getAttribute("aria-checked")).toBe("true");

  await user.click(screen.getByRole("button", { name: "Add follow-up" }));

  await waitFor(() =>
    expect(createFollowupAction).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedUserIds: ["user-2"],
        visibilityChoice: "selected_members",
      }),
    ),
  );
});
