import { describe, expect, it } from "vitest";
import { toGeneralActionView } from "@/lib/general-action-view";

const OWNER = "user-1";
const MEMBER = "user-2";

function baseAction(overrides: Partial<Parameters<typeof toGeneralActionView>[0]> = {}) {
  return {
    id: "a1",
    title: "Replace the water filter",
    notes: null,
    links: [],
    assetHints: [],
    linkedPeople: [],
    status: "open" as const,
    recurrence: null,
    scope: "private" as const,
    ownerUserId: OWNER,
    sharedWithCount: 0,
    householdName: null,
    dueAt: null,
    deferUntil: null,
    areaId: null,
    ...overrides,
  };
}

describe("toGeneralActionView scope + ownership", () => {
  it("marks a private action owned by its viewer with a bare visibility label", () => {
    const view = toGeneralActionView(baseAction(), { callerUserId: OWNER });

    expect(view.scope).toBe("private");
    expect(view.visibilityLabel).toBe("Only me");
    expect(view.owned).toBe(true);
  });

  it("labels a household action and flags a non-owner viewer as not owning it", () => {
    const view = toGeneralActionView(baseAction({ scope: "household" }), { callerUserId: MEMBER });

    expect(view.scope).toBe("household");
    // No household name → falls back to the plain scope label.
    expect(view.visibilityLabel).toBe("Whole household");
    // A member may see and act on it, but does not own it — no content/visibility edit.
    expect(view.owned).toBe(false);
  });

  it("names the audience on the scope label: household name and shared count", () => {
    const household = toGeneralActionView(
      baseAction({ scope: "household", householdName: "Smith Household" }),
      { callerUserId: OWNER },
    );
    expect(household.visibilityLabel).toBe("Smith Household");

    const shared = toGeneralActionView(baseAction({ scope: "shared", sharedWithCount: 2 }), {
      callerUserId: OWNER,
    });
    expect(shared.visibilityLabel).toBe("Specific people · 2");
  });

  it("carries linked people and asset hints through to the surface", () => {
    const view = toGeneralActionView(
      baseAction({
        linkedPeople: [{ id: "p1", displayName: "Mara" }],
        assetHints: [{ label: "refrigerator water filter" }],
      }),
      { callerUserId: OWNER },
    );

    expect(view.linkedPeople).toEqual([{ id: "p1", displayName: "Mara" }]);
    expect(view.assetHints).toEqual([{ label: "refrigerator water filter" }]);
  });
});

describe("toGeneralActionView routines + paused state", () => {
  it("labels a routine with a plain cadence and flags it as a Routine", () => {
    const routine = toGeneralActionView(
      baseAction({ recurrence: { interval: 6, unit: "month" } }),
      { callerUserId: OWNER },
    );
    expect(routine.isRoutine).toBe(true);
    expect(routine.recurrence).toEqual({ interval: 6, unit: "month" });
    expect(routine.recurrenceLabel).toBe("Every 6 months");
  });

  it("leaves a one-time action without any cadence label", () => {
    const oneTime = toGeneralActionView(baseAction(), { callerUserId: OWNER });
    expect(oneTime.isRoutine).toBe(false);
    expect(oneTime.recurrenceLabel).toBeNull();
  });

  it("reads a paused routine as quietly set aside, never overdue", () => {
    const paused = toGeneralActionView(
      baseAction({
        status: "paused",
        recurrence: { interval: 1, unit: "week" },
        // Even with a due date in the past, a paused routine never reads as overdue.
        dueAt: new Date("2020-01-01T00:00:00Z"),
      }),
      { callerUserId: OWNER },
    );
    expect(paused.surfaceState).toBe("paused");
    expect(paused.surfaceLabel).toBe("Paused");
  });
});
