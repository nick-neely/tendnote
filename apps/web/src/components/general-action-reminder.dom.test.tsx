// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

vi.mock("@/app/actions/reminders", () => ({
  registerReminderInstallationAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

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
});
