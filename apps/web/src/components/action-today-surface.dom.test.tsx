// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { ActionTodayGroup } from "@/lib/action-today";
import { render, screen, setMatchMedia } from "@/test/dom";

/**
 * DOM coverage for the narrow Action Today surface (ADR 0161 viewport gap; /actions/today).
 * jsdom applies no media queries, so it renders the mobile-first base layer — this asserts
 * the glance's rows are present and, crucially, each carries the deep link that hops to the
 * exact ledger row (`/actions#action-<id>`, the landing side of which the deep-link hook
 * test covers). That link + reachability is the honest narrow-viewport check: the controls
 * a phone user needs are in the document and operable, not pixel layout.
 */

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { ActionTodaySurface } from "./action-today-surface";

const DUE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OVERDUE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function groups(): ActionTodayGroup[] {
  return [
    {
      reason: "due_today",
      heading: "Today",
      items: [
        {
          reason: "due_today",
          view: generalActionViewFixture({
            id: DUE_ID,
            title: "Water the plants",
            surfaceLabel: "Due today",
          }),
        },
      ],
    },
    {
      reason: "overdue",
      heading: "Earlier",
      items: [
        {
          reason: "overdue",
          view: generalActionViewFixture({
            id: OVERDUE_ID,
            title: "Call the plumber",
            surfaceLabel: "Was due Jul 3",
          }),
        },
      ],
    },
  ];
}

describe("ActionTodaySurface (narrow viewport / ledger hop)", () => {
  it("renders each row as a deep link to its exact ledger row", () => {
    setMatchMedia(true); // answer narrow-viewport queries as a phone
    render(<ActionTodaySurface groups={groups()} />);

    const due = screen.getByRole("link", { name: /Water the plants/ });
    expect(due.getAttribute("href")).toBe(`/actions#action-${DUE_ID}`);

    const overdue = screen.getByRole("link", { name: /Call the plumber/ });
    expect(overdue.getAttribute("href")).toBe(`/actions#action-${OVERDUE_ID}`);

    // The calm per-row caption states each row's own honest timeliness.
    expect(screen.getByText("Due today")).toBeTruthy();
    expect(screen.getByText("Was due Jul 3")).toBeTruthy();
  });

  it("shows a calm empty glance with a route to the ledger when nothing is on today", () => {
    setMatchMedia(true);
    render(<ActionTodaySurface groups={[]} />);

    expect(screen.getByText(/Nothing on today\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Actions" }).getAttribute("href")).toBe(
      "/actions",
    );
  });
});
