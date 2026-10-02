// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MonthMeter } from "./month-meter";

afterEach(cleanup);

describe("MonthMeter", () => {
  it("steps through a month by button, each limit with its notice and one reset date", async () => {
    const user = userEvent.setup();
    render(<MonthMeter />);

    expect(screen.getByText("Full quality")).toBeTruthy();
    expect(screen.getByText(/No notice/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Past about 250 turns" }));
    expect(screen.getByText("Lighter model")).toBeTruthy();
    expect(screen.getByText(/lighter model for the rest of this month\. Resets on/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "At the monthly limit" }));
    expect(screen.getByText("Paused, no new turns")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "At the monthly limit" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Reset day" }));
    expect(screen.getByText("Full quality")).toBeTruthy();
  });

  it("keeps reminders, records, export, and billing working in every state", async () => {
    const user = userEvent.setup();
    render(<MonthMeter />);
    await user.click(screen.getByRole("button", { name: "At the monthly limit" }));
    for (const item of ["Reminders", "Export", "Billing and cancelling", "Your notes and people"]) {
      expect(screen.getByText(item)).toBeTruthy();
    }
  });
});
