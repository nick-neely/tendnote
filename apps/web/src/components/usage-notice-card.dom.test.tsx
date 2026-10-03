// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/dom";
import { BackgroundUsageNotice } from "./usage-notice-card";

const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

describe("BackgroundUsageNotice", () => {
  it("says background work is paused and when it resets", () => {
    render(
      <BackgroundUsageNotice
        usage={{
          background: paused,
          scheduled: paused,
        }}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Background work is paused for this month.");
    expect(notice.textContent).toContain("briefs and reviews skip their next delivery");
    expect(notice.textContent).toContain("Resets on November 15.");
  });

  it("gives no date and leaves briefs out while the Spend Breaker has shed only captures", () => {
    render(
      <BackgroundUsageNotice
        usage={{
          background: { state: "paused", recovery: { kind: "service_restored" } },
          scheduled: { state: "normal" },
        }}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Resumes when service is restored.");
    expect(notice.textContent).not.toContain("briefs");
    expect(notice.textContent).not.toMatch(/Resets on|month/);
  });

  it("shows nothing while background work runs, or when usage could not be read", () => {
    const { container, rerender } = render(
      <BackgroundUsageNotice
        usage={{ background: { state: "normal" }, scheduled: { state: "normal" } }}
      />,
    );
    expect(container.innerHTML).toBe("");

    rerender(<BackgroundUsageNotice />);
    expect(container.innerHTML).toBe("");
  });
});
