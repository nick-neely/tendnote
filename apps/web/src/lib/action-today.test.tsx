import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionTodaySurface } from "@/components/action-today-surface";
import {
  actionTodayCaption,
  groupActionTodayItems,
  selectActionTodayItems,
} from "@/lib/action-today";
import type { GeneralActionView } from "@/lib/general-action-view";

// Local-midnight fixtures, matching how due dates are stored (timezone-independent).
const NOW = new Date(2026, 6, 6, 9, 0, 0);

function view(overrides: Partial<GeneralActionView> = {}): GeneralActionView {
  return {
    id: "a1",
    title: "Replace the water filter",
    notes: null,
    links: [],
    assetHints: [],
    linkedAssets: [],
    linkedPeople: [],
    status: "open",
    recurrence: null,
    isRoutine: false,
    recurrenceLabel: null,
    scope: "private",
    visibilityLabel: "Only me",
    owned: true,
    ownerUserId: "owner-1",
    areaId: null,
    dueAtISO: null,
    dueAtDate: "",
    deferUntilISO: null,
    deferUntilDate: "",
    surfaceState: "unscheduled",
    surfaceLabel: "No date",
    ...overrides,
  };
}

function entry(
  action: { status: GeneralActionView["status"]; dueAt: Date | null; deferUntil: Date | null },
  v: GeneralActionView,
) {
  return { action, view: v };
}

describe("action today selection", () => {
  it("keeps only surfacing actions, dropping unscheduled, future, not-yet-deferred, paused, and terminal", () => {
    const items = selectActionTodayItems(
      [
        entry(
          { status: "open", dueAt: new Date(2026, 6, 6), deferUntil: null },
          view({ id: "due", surfaceState: "today", surfaceLabel: "Due today" }),
        ),
        entry(
          { status: "open", dueAt: new Date(2026, 6, 1), deferUntil: null },
          view({ id: "overdue", surfaceState: "overdue", surfaceLabel: "Was due Jul 1" }),
        ),
        entry(
          { status: "deferred", dueAt: null, deferUntil: new Date(2026, 6, 5) },
          view({ id: "back", surfaceState: "deferred", surfaceLabel: "Set aside until Jul 5" }),
        ),
        entry({ status: "open", dueAt: null, deferUntil: null }, view({ id: "someday" })),
        entry(
          { status: "open", dueAt: new Date(2026, 6, 20), deferUntil: null },
          view({ id: "future" }),
        ),
        entry(
          { status: "deferred", dueAt: null, deferUntil: new Date(2026, 7, 1) },
          view({ id: "not-yet" }),
        ),
        entry(
          { status: "paused", dueAt: new Date(2026, 0, 1), deferUntil: null },
          view({ id: "paused" }),
        ),
        entry(
          { status: "completed", dueAt: new Date(2026, 0, 1), deferUntil: null },
          view({ id: "done" }),
        ),
        // Review-gated proposals never surface, even with a past due date (ADRs 0151, 0152).
        entry(
          { status: "suggested", dueAt: new Date(2026, 0, 1), deferUntil: null },
          view({ id: "suggested" }),
        ),
        entry(
          { status: "ignored", dueAt: new Date(2026, 0, 1), deferUntil: null },
          view({ id: "ignored" }),
        ),
      ],
      NOW,
    );

    expect(items.map((item) => [item.view.id, item.reason])).toEqual([
      ["due", "due_today"],
      ["overdue", "overdue"],
      ["back", "resurfaced"],
    ]);
  });
});

describe("action today grouping", () => {
  const dueItem = { reason: "due_today" as const, view: view({ id: "due" }) };
  const overdueItem = { reason: "overdue" as const, view: view({ id: "overdue" }) };
  const backItem = { reason: "resurfaced" as const, view: view({ id: "back" }) };

  it("orders groups as today, came back, then earlier, and omits empty groups", () => {
    const groups = groupActionTodayItems([overdueItem, dueItem]);
    expect(groups.map((group) => [group.reason, group.heading])).toEqual([
      ["due_today", "Today"],
      ["overdue", "Earlier"],
    ]);

    const all = groupActionTodayItems([overdueItem, backItem, dueItem]);
    expect(all.map((group) => group.reason)).toEqual(["due_today", "resurfaced", "overdue"]);
  });

  it("gives each row its own honest caption, not an echo of the group heading", () => {
    // A resurfaced row carries its "Set aside until …" label rather than repeating the
    // "Came back" heading, so heading and caption never say near-identical things.
    expect(
      actionTodayCaption({
        reason: "resurfaced",
        view: view({ surfaceLabel: "Set aside until Jul 5" }),
      }),
    ).toBe("Set aside until Jul 5");
    expect(
      actionTodayCaption({ reason: "overdue", view: view({ surfaceLabel: "Was due Jul 1" }) }),
    ).toBe("Was due Jul 1");
  });
});

describe("action today surface", () => {
  it("renders grouped rows with calm captions and no accent pills or counts", () => {
    const groups = groupActionTodayItems([
      {
        reason: "due_today",
        view: view({ id: "due", title: "Pay water bill", surfaceLabel: "Due today" }),
      },
      {
        reason: "resurfaced",
        view: view({ id: "back", title: "Book dentist", surfaceLabel: "Set aside until Jul 5" }),
      },
    ]);

    const html = renderToStaticMarkup(<ActionTodaySurface groups={groups} />);

    expect(html).toContain("Today");
    expect(html).toContain("Came back");
    expect(html).toContain("Pay water bill");
    // Each row carries its own honest caption, never an echo of the group heading.
    expect(html).toContain("Set aside until Jul 5");
    expect(html).not.toContain("Came back around");
    // Rows deep-link to their exact ledger row, not the bare Actions page.
    expect(html).toContain("/actions#action-back");
    // Never an accent pill (the loud "due now" chip) on a page that is already today.
    expect(html).not.toContain("bg-accent-soft");
    // No count-as-badge anywhere.
    expect(html).not.toMatch(/\b2 items?\b/);
  });

  it("shows a calm empty state linking to Actions when nothing is on today", () => {
    const html = renderToStaticMarkup(<ActionTodaySurface groups={[]} />);
    expect(html).toContain("Nothing on today");
    expect(html).toContain("/actions");
  });
});
