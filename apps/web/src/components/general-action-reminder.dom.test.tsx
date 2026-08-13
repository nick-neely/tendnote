// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, userEvent } from "@/test/dom";

vi.mock("@/app/actions/reminders", () => ({
  registerReminderInstallationAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

// Radix's Select measures and scrolls its content on open; jsdom implements
// none of that.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

import { GeneralActionReminderField } from "./general-action-reminder";

describe("GeneralActionReminderField", () => {
  it("normalizes a newly enabled Routine reminder to its occurrence-relative rule", async () => {
    const user = userEvent.setup();
    const onChoiceChange = vi.fn();
    const onEnabledChange = vi.fn();
    render(
      <GeneralActionReminderField
        choice={{ kind: "exact", localTime: "09:00" }}
        enabled={false}
        onChoiceChange={onChoiceChange}
        onEnabledChange={onEnabledChange}
        relativeOnly
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Remind me" }));

    expect(onChoiceChange).toHaveBeenCalledWith({ kind: "relative", leadMinutes: 0 });
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("reads the chosen alert time back as a schedule choice", async () => {
    const user = userEvent.setup();
    const onChoiceChange = vi.fn();
    render(
      <GeneralActionReminderField
        choice={{ kind: "exact", localTime: "09:00" }}
        enabled
        onChoiceChange={onChoiceChange}
        onEnabledChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Reminder alert time" }));
    await user.click(await screen.findByRole("option", { name: "One day before at 9:00 AM" }));

    expect(onChoiceChange).toHaveBeenCalledWith({ kind: "relative", leadMinutes: 1_440 });
  });

  it("keeps a fixed alert time whole, so the schedule schema accepts it", async () => {
    const user = userEvent.setup();
    const onChoiceChange = vi.fn();
    render(
      <GeneralActionReminderField
        choice={{ kind: "relative", leadMinutes: 1_440 }}
        enabled
        onChoiceChange={onChoiceChange}
        onEnabledChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Reminder alert time" }));
    await user.click(await screen.findByRole("option", { name: "At 9:00 AM on the due date" }));

    // Not "09": the option's payload is an hh:mm time, and the schedule schema
    // requires both halves.
    expect(onChoiceChange).toHaveBeenCalledWith({ kind: "exact", localTime: "09:00" });
  });

  it("lets a one-time Action choose any exact local alert time", () => {
    const onChoiceChange = vi.fn();
    render(
      <GeneralActionReminderField
        allowCustomExactTime
        choice={{ kind: "exact", localTime: "09:00" }}
        enabled
        onChoiceChange={onChoiceChange}
        onEnabledChange={vi.fn()}
      />,
    );

    const time = screen.getByLabelText("Exact reminder time");
    fireEvent.change(time, { target: { value: "15:30" } });

    expect(onChoiceChange).toHaveBeenLastCalledWith({ kind: "exact", localTime: "15:30" });
  });

  it("does not emit an empty or invalid exact local time", () => {
    const onChoiceChange = vi.fn();
    render(
      <GeneralActionReminderField
        allowCustomExactTime
        choice={{ kind: "exact", localTime: "15:30" }}
        enabled
        onChoiceChange={onChoiceChange}
        onEnabledChange={vi.fn()}
      />,
    );

    const time = screen.getByLabelText("Exact reminder time");
    fireEvent.change(time, { target: { value: "" } });

    expect(onChoiceChange).not.toHaveBeenCalled();
  });

  it("drops the fixed-time option when only occurrence-relative rules apply", async () => {
    const user = userEvent.setup();
    render(
      <GeneralActionReminderField
        choice={{ kind: "relative", leadMinutes: 0 }}
        enabled
        onChoiceChange={vi.fn()}
        onEnabledChange={vi.fn()}
        relativeOnly
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Reminder alert time" }));

    expect(await screen.findByRole("option", { name: "One day before at 9:00 AM" })).toBeDefined();
    expect(screen.queryByRole("option", { name: "At 9:00 AM on the due date" })).toBeNull();
  });
});
