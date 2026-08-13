// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createGeneralActionAction } from "@/app/actions/general-actions";
import { saveReminderAction } from "@/app/actions/reminders";
import { CreateActionForm } from "@/components/general-action-create-form";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import { fireEvent, render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("@/app/actions/general-actions", () => ({
  createGeneralActionAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  registerReminderInstallationAction: vi.fn(),
  saveReminderAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

describe("CreateActionForm reminders", () => {
  it("creates a one-time Action with a custom exact local reminder time", async () => {
    const user = userEvent.setup();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    const dueAtDate = localDateValue(dueDate);
    const created = generalActionViewFixture({
      id: "22222222-2222-2222-2222-222222222222",
      dueAtDate,
      dueAtISO: `${dueAtDate}T00:00:00.000Z`,
    });
    vi.mocked(createGeneralActionAction).mockResolvedValue({ ok: true, view: created });
    vi.mocked(saveReminderAction).mockResolvedValue({
      ok: true,
      view: {
        optIn: { state: "none", clientInstallationId: "browser-installation-1" },
        occurrenceIntentCreated: true,
        nextValidChoice: null,
        schedule: {
          kind: "exact",
          localTime: "15:45",
          leadMinutes: null,
          timeZone: "UTC",
          intendedAtISO: `${dueAtDate}T15:45:00.000Z`,
        },
      },
    });
    const onCreate = vi.fn();
    render(<CreateActionForm areas={[]} onCreate={onCreate} />);

    await user.type(screen.getByLabelText("What do you want to get done?"), "Call the dentist");
    await user.click(screen.getByText("Add date, details, or sharing"));
    await user.click(screen.getByRole("combobox", { name: "Due date (optional)" }));
    const day = document.querySelector<HTMLButtonElement>(`[data-day="${dueAtDate}"] button`);
    expect(day).not.toBeNull();
    await user.click(day as HTMLButtonElement);
    await user.click(screen.getByRole("checkbox", { name: "Remind me" }));
    fireEvent.change(screen.getByLabelText("Exact reminder time"), {
      target: { value: "15:45" },
    });
    await user.click(screen.getByRole("button", { name: "Add action" }));

    await waitFor(() =>
      expect(saveReminderAction).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: created.id,
          recordKind: "general_action",
          schedule: { kind: "exact", localTime: "15:45" },
        }),
      ),
    );
    expect(onCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reminderSchedule: expect.objectContaining({ kind: "exact", localTime: "15:45" }),
      }),
    );
  });
});
