// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/dom";
import { BackgroundUsageNotice } from "./usage-notice-card";

describe("BackgroundUsageNotice", () => {
  it("says background work is paused and when it resets", () => {
    render(
      <BackgroundUsageNotice
        notice={{ state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } }}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Background work is paused for this month.");
    expect(notice.textContent).toContain("Resets on November 15.");
  });

  it("shows nothing while background work runs, or when usage could not be read", () => {
    const { container, rerender } = render(<BackgroundUsageNotice notice={{ state: "normal" }} />);
    expect(container.innerHTML).toBe("");

    rerender(<BackgroundUsageNotice />);
    expect(container.innerHTML).toBe("");
  });
});
