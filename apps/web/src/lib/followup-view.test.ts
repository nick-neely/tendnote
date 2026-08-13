import type { Followup } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { parseDateInputValue, toFollowupView } from "./followup-view";

const NOW = new Date("2026-06-27T12:00:00Z");

function followup(overrides: Partial<Followup> = {}): Followup {
  return {
    id: "followup-1",
    personId: "person-1",
    ownerUserId: "user-1",
    reason: "Reconnect about the move.",
    dueAt: new Date("2026-06-27T00:00:00Z"),
    status: "open",
    cadence: null,
    lastPromptedAt: null,
    householdId: null,
    scope: "private",
    createdByUserId: "user-1",
    lastActorUserId: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("parseDateInputValue", () => {
  it("parses a date input value to local midnight on the same calendar day", () => {
    const date = parseDateInputValue("2026-07-04");

    // Local parts must match the input exactly — no UTC off-by-one day shift.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(4);
    expect(date.getHours()).toBe(0);
  });

  it("round-trips through the view's date value without drifting a day", () => {
    const view = toFollowupView(followup({ dueAt: parseDateInputValue("2026-12-31") }), NOW);

    expect(view.dueAtDate).toBe("2026-12-31");
  });

  it("rejects a non-date string", () => {
    expect(() => parseDateInputValue("next week")).toThrow();
  });
});

describe("toFollowupView", () => {
  it("maps a follow-up to a serializable view with computed due state", () => {
    const view = toFollowupView(
      followup({ dueAt: new Date("2026-07-04T00:00:00"), reason: "Send the photos." }),
      NOW,
    );

    expect(view.reason).toBe("Send the photos.");
    expect(view.status).toBe("open");
    expect(view.dueState).toBe("upcoming");
    expect(view.dueAtDate).toBe("2026-07-04");
    expect(view.dueLabel).toContain("Jul");
    expect(view.surfaceLabel).toBe("Due Jul 4");
    expect(view.visibilityChoice).toBe("only_me");
    expect(view.visibilityLabel).toBe("Only me");
    expect(view.owned).toBe(true);
    expect(view.revision).toBe(NOW.toISOString());
  });

  it("names a selected audience and marks a viewing member as a non-owner", () => {
    const view = toFollowupView(
      {
        ...followup({
          householdId: "household-1",
          scope: "shared",
        }),
        householdName: "Home",
        sharedWithCount: 2,
      },
      NOW,
      null,
      "member-1",
    );

    expect(view.visibilityLabel).toBe("Shared with 2 people");
    expect(view.owned).toBe(false);
    expect(view.ownerUserId).toBe("user-1");
  });
});
