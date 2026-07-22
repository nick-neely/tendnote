// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const createBirthdayFollowupAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions/followups", () => ({
  createBirthdayFollowupAction: (...args: unknown[]) => createBirthdayFollowupAction(...args),
}));

vi.mock("@/app/actions/reminders", () => ({
  registerReminderInstallationAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { BirthdayFollowupOffer } from "./birthday-followup-offer";

describe("BirthdayFollowupOffer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createBirthdayFollowupAction.mockReset();
    refresh.mockReset();
  });

  it("creates only an explicit annual Follow-Up with a concrete relative schedule", async () => {
    const user = userEvent.setup();
    createBirthdayFollowupAction.mockResolvedValue({
      view: {
        id: "11111111-1111-1111-1111-111111111111",
        reason: "Celebrate Mara's birthday",
        reminderSchedule: { label: "Reminder one week before at 9:00 AM · America/Chicago" },
      },
      optIn: { state: "none", clientInstallationId: "installation-1" },
    });
    render(
      <BirthdayFollowupOffer personId="22222222-2222-2222-2222-222222222222" personName="Mara" />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Reminder schedule" }),
      "week_before",
    );
    await user.click(screen.getByRole("button", { name: "Create for Mara" }));

    await waitFor(() =>
      expect(createBirthdayFollowupAction).toHaveBeenCalledWith(
        expect.objectContaining({
          personId: "22222222-2222-2222-2222-222222222222",
          schedule: { kind: "relative", leadMinutes: 10_080 },
        }),
      ),
    );
    expect(await screen.findByText(/Celebrate Mara's birthday/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});
