// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PlanPanel } from "./plan-panel";

afterEach(cleanup);

describe("PlanPanel", () => {
  it("states the monthly price first and the yearly price once chosen, from the keyboard", async () => {
    const user = userEvent.setup();
    render(<PlanPanel subscribeHref="https://app.tendnote.com/sign-up" />);

    expect(screen.getByText("$20 a month")).toBeTruthy();
    expect(screen.getByText(/plus applicable sales tax/i)).toBeTruthy();

    screen.getByRole("radio", { name: "Monthly" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "Yearly" })).toHaveProperty("checked", true);
    expect(screen.getByText("$200 a year")).toBeTruthy();
  });

  it("sends Subscribe to hosted sign-up, which owns checkout", () => {
    render(<PlanPanel subscribeHref="https://app.tendnote.com/sign-up" />);
    expect(screen.getByRole("link", { name: "Subscribe" }).getAttribute("href")).toBe(
      "https://app.tendnote.com/sign-up",
    );
  });
});
