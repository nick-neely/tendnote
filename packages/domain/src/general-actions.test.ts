import { describe, expect, it } from "vitest";
import {
  assertGeneralActionEditable,
  assertPausableRoutine,
  assertRecurrenceEditAllowed,
  assertResurfaceDate,
  describeRecurrence,
  type GeneralActionRecurrence,
  generalActionAssetHintSchema,
  generalActionEditSchema,
  generalActionLinkSchema,
  generalActionRecurrenceSchema,
  generalActionSchema,
  generalActionUpdateSchema,
  isActiveGeneralActionStatus,
  isGeneralActionRoutine,
  isProactivelySurfacing,
  MAX_RECURRENCE_INTERVAL,
  nextRoutineDueAt,
  resolveGeneralActionTransition,
} from "./general-actions";

describe("general action lifecycle transitions", () => {
  it("completes, defers, dismisses, and archives an open action", () => {
    expect(resolveGeneralActionTransition("open", "complete")).toBe("completed");
    expect(resolveGeneralActionTransition("open", "defer")).toBe("deferred");
    expect(resolveGeneralActionTransition("open", "dismiss")).toBe("dismissed");
    expect(resolveGeneralActionTransition("open", "archive")).toBe("archived");
  });

  it("re-defers and completes a deferred action", () => {
    expect(resolveGeneralActionTransition("deferred", "defer")).toBe("deferred");
    expect(resolveGeneralActionTransition("deferred", "complete")).toBe("completed");
  });

  it("reopens completed and dismissed actions but not archived ones", () => {
    expect(resolveGeneralActionTransition("completed", "reopen")).toBe("open");
    expect(resolveGeneralActionTransition("dismissed", "reopen")).toBe("open");
    expect(() => resolveGeneralActionTransition("archived", "reopen")).toThrow(/Cannot reopen/);
  });

  it("rejects invalid jumps with a clear error", () => {
    expect(() => resolveGeneralActionTransition("completed", "complete")).toThrow(
      /Cannot complete/,
    );
    expect(() => resolveGeneralActionTransition("archived", "archive")).toThrow(/Cannot archive/);
    expect(() => resolveGeneralActionTransition("open", "reopen")).toThrow(/Cannot reopen/);
  });

  it("pauses an active Routine and resumes it, and never pauses a paused one", () => {
    expect(resolveGeneralActionTransition("open", "pause")).toBe("paused");
    expect(resolveGeneralActionTransition("deferred", "pause")).toBe("paused");
    expect(resolveGeneralActionTransition("paused", "resume")).toBe("open");
    expect(() => resolveGeneralActionTransition("paused", "pause")).toThrow(/Cannot pause/);
    expect(() => resolveGeneralActionTransition("completed", "resume")).toThrow(/Cannot resume/);
  });

  it("archives a paused Routine", () => {
    expect(resolveGeneralActionTransition("paused", "archive")).toBe("archived");
  });
});

describe("active + editable status guards", () => {
  it("treats open and deferred as active, terminal states as inactive", () => {
    expect(isActiveGeneralActionStatus("open")).toBe(true);
    expect(isActiveGeneralActionStatus("deferred")).toBe(true);
    expect(isActiveGeneralActionStatus("completed")).toBe(false);
    expect(isActiveGeneralActionStatus("archived")).toBe(false);
  });

  it("blocks editing terminal actions but allows editing a paused Routine", () => {
    expect(() => assertGeneralActionEditable("open")).not.toThrow();
    expect(() => assertGeneralActionEditable("deferred")).not.toThrow();
    expect(() => assertGeneralActionEditable("paused")).not.toThrow();
    expect(() => assertGeneralActionEditable("completed")).toThrow(/Cannot edit/);
    expect(() => assertGeneralActionEditable("archived")).toThrow(/Cannot edit/);
  });

  it("treats paused as inactive (a paused Routine does not surface as on-your-plate)", () => {
    expect(isActiveGeneralActionStatus("paused")).toBe(false);
  });
});

describe("routine identity + pause guard", () => {
  const cadence: GeneralActionRecurrence = { interval: 6, unit: "month" };

  it("a General Action with a cadence is a Routine; without one it is not", () => {
    expect(isGeneralActionRoutine({ recurrence: cadence })).toBe(true);
    expect(isGeneralActionRoutine({ recurrence: null })).toBe(false);
  });

  it("only a Routine can be paused", () => {
    expect(() => assertPausableRoutine({ recurrence: cadence })).not.toThrow();
    expect(() => assertPausableRoutine({ recurrence: null })).toThrow(
      /Only a routine can be paused/,
    );
  });

  it("blocks removing a paused Routine's cadence but allows changing it", () => {
    // Removing cadence while paused would leave a paused one-time Action — rejected.
    expect(() => assertRecurrenceEditAllowed("paused", null)).toThrow(/Resume this routine/);
    // Changing the cadence while paused is fine; so is any edit while active.
    expect(() => assertRecurrenceEditAllowed("paused", cadence)).not.toThrow();
    expect(() => assertRecurrenceEditAllowed("open", null)).not.toThrow();
    // An untouched cadence (undefined) never trips the guard.
    expect(() => assertRecurrenceEditAllowed("paused", undefined)).not.toThrow();
  });
});

describe("routine cadence roll-forward", () => {
  // Anchored on the completion moment (`from`), not the previous due date, and
  // normalized to local midnight of the target calendar day.
  it("rolls forward by day, week, month, and year", () => {
    const from = new Date(2026, 0, 10, 9, 30); // Jan 10 2026, 09:30 local
    expect(nextRoutineDueAt({ interval: 3, unit: "day" }, from)).toEqual(new Date(2026, 0, 13));
    expect(nextRoutineDueAt({ interval: 2, unit: "week" }, from)).toEqual(new Date(2026, 0, 24));
    expect(nextRoutineDueAt({ interval: 6, unit: "month" }, from)).toEqual(new Date(2026, 6, 10));
    expect(nextRoutineDueAt({ interval: 1, unit: "year" }, from)).toEqual(new Date(2027, 0, 10));
  });

  it("clamps month-end so Jan 31 + 1 month lands on the last day of February", () => {
    const jan31 = new Date(2026, 0, 31, 12, 0);
    // 2026 is not a leap year → Feb 28.
    expect(nextRoutineDueAt({ interval: 1, unit: "month" }, jan31)).toEqual(new Date(2026, 1, 28));
    // A leap year clamps to Feb 29.
    const jan31Leap = new Date(2028, 0, 31, 12, 0);
    expect(nextRoutineDueAt({ interval: 1, unit: "month" }, jan31Leap)).toEqual(
      new Date(2028, 1, 29),
    );
  });

  it("clamps a leap-day yearly cadence to Feb 28 in a common year", () => {
    const feb29 = new Date(2028, 1, 29, 8, 0);
    expect(nextRoutineDueAt({ interval: 1, unit: "year" }, feb29)).toEqual(new Date(2029, 1, 28));
  });

  it("crosses a year boundary on a monthly cadence", () => {
    const nov15 = new Date(2026, 10, 15, 0, 0);
    expect(nextRoutineDueAt({ interval: 3, unit: "month" }, nov15)).toEqual(new Date(2027, 1, 15));
  });

  it("always lands at local midnight regardless of the completion time of day", () => {
    const late = new Date(2026, 2, 1, 23, 59, 59);
    const rolled = nextRoutineDueAt({ interval: 1, unit: "week" }, late);
    expect(rolled.getHours()).toBe(0);
    expect(rolled.getMinutes()).toBe(0);
    expect(rolled).toEqual(new Date(2026, 2, 8));
  });
});

describe("proactive resurfacing", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("surfaces an open action due today or overdue", () => {
    expect(
      isProactivelySurfacing(
        { status: "open", dueAt: new Date("2026-07-06T00:00:00Z"), deferUntil: null },
        now,
      ),
    ).toBe(true);
    expect(
      isProactivelySurfacing(
        { status: "open", dueAt: new Date("2026-07-01T00:00:00Z"), deferUntil: null },
        now,
      ),
    ).toBe(true);
  });

  it("does not surface a future-dated action", () => {
    expect(
      isProactivelySurfacing(
        { status: "open", dueAt: new Date("2026-07-20T00:00:00Z"), deferUntil: null },
        now,
      ),
    ).toBe(false);
  });

  it("never floods proactive surfaces with an unscheduled action", () => {
    expect(isProactivelySurfacing({ status: "open", dueAt: null, deferUntil: null }, now)).toBe(
      false,
    );
  });

  it("surfaces a deferred action only once its resurface date has arrived", () => {
    expect(
      isProactivelySurfacing(
        { status: "deferred", dueAt: null, deferUntil: new Date("2026-07-05T00:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isProactivelySurfacing(
        { status: "deferred", dueAt: null, deferUntil: new Date("2026-08-01T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("never surfaces paused or terminal actions", () => {
    for (const status of ["paused", "completed", "dismissed", "archived"] as const) {
      expect(
        isProactivelySurfacing(
          { status, dueAt: new Date("2026-01-01T00:00:00Z"), deferUntil: null },
          now,
        ),
      ).toBe(false);
    }
  });
});

describe("recurrence description", () => {
  it("reads plainly, singular and plural, without pressure language", () => {
    expect(describeRecurrence({ interval: 1, unit: "day" })).toBe("Every day");
    expect(describeRecurrence({ interval: 1, unit: "week" })).toBe("Every week");
    expect(describeRecurrence({ interval: 6, unit: "month" })).toBe("Every 6 months");
    expect(describeRecurrence({ interval: 2, unit: "year" })).toBe("Every 2 years");
  });
});

describe("recurrence schema", () => {
  it("requires a positive, bounded interval and a known unit", () => {
    expect(generalActionRecurrenceSchema.parse({ interval: 6, unit: "month" })).toEqual({
      interval: 6,
      unit: "month",
    });
    expect(() => generalActionRecurrenceSchema.parse({ interval: 0, unit: "day" })).toThrow();
    expect(() =>
      generalActionRecurrenceSchema.parse({ interval: MAX_RECURRENCE_INTERVAL + 1, unit: "day" }),
    ).toThrow();
    expect(() => generalActionRecurrenceSchema.parse({ interval: 1, unit: "fortnight" })).toThrow();
  });

  it("defaults recurrence to null so an ordinary action is one-time", () => {
    const action = generalActionSchema.parse({
      id: "a1",
      ownerUserId: "user-1",
      title: "Renew the registration",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(action.recurrence).toBeNull();
  });

  it("carries a cadence on a Routine and edits it via the edit schema", () => {
    const routine = generalActionSchema.parse({
      id: "a1",
      ownerUserId: "user-1",
      title: "Replace the refrigerator water filter",
      recurrence: { interval: 6, unit: "month" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(routine.recurrence).toEqual({ interval: 6, unit: "month" });

    // An explicit null in an edit makes a Routine one-time again; an object changes cadence.
    expect(generalActionEditSchema.parse({ recurrence: null })).toHaveProperty("recurrence", null);
    expect(
      generalActionEditSchema.parse({ recurrence: { interval: 2, unit: "week" } }).recurrence,
    ).toEqual({ interval: 2, unit: "week" });
  });
});

describe("resurface date guard", () => {
  it("requires a concrete resurface date to defer", () => {
    const date = new Date("2026-08-01T00:00:00Z");
    expect(assertResurfaceDate(date)).toBe(date);
    expect(() => assertResurfaceDate(new Date("not a date"))).toThrow(/concrete resurface date/);
    expect(() => assertResurfaceDate(undefined)).toThrow(/concrete resurface date/);
  });
});

describe("schema shape", () => {
  it("allows an unscheduled action with no due date and empty links", () => {
    const action = generalActionSchema.parse({
      id: "a1",
      ownerUserId: "user-1",
      title: "Replace the refrigerator water filter",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(action.status).toBe("open");
    expect(action.dueAt).toBeNull();
    expect(action.deferUntil).toBeNull();
    expect(action.scope).toBe("private");
    expect(action.links).toEqual([]);
    expect(action.notes).toBeNull();
  });

  it("rejects a blank title", () => {
    expect(() =>
      generalActionSchema.parse({
        id: "a1",
        ownerUserId: "user-1",
        title: "   ",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });

  it("validates lightweight links as URLs with optional labels", () => {
    expect(generalActionLinkSchema.parse({ url: "https://example.com" }).url).toBe(
      "https://example.com",
    );
    expect(
      generalActionLinkSchema.parse({ url: "https://example.com", label: "Filter" }).label,
    ).toBe("Filter");
    expect(() => generalActionLinkSchema.parse({ url: "not-a-url" })).toThrow();
  });

  it("update schema keeps absent keys absent (no default injection) so updates never wipe columns", () => {
    // A partial of the base schema would inject dueAt/notes/links/scope defaults
    // here and silently clear those columns on a status-only update.
    const patch = generalActionUpdateSchema.parse({
      status: "deferred",
      deferUntil: new Date("2026-08-01T00:00:00Z"),
      lastActorUserId: "user-1",
    });

    expect(Object.keys(patch).sort()).toEqual(["deferUntil", "lastActorUserId", "status"]);
    expect(patch).not.toHaveProperty("dueAt");
    expect(patch).not.toHaveProperty("notes");
    expect(patch).not.toHaveProperty("links");
    // An explicit null still clears a nullable field.
    expect(generalActionUpdateSchema.parse({ dueAt: null })).toEqual({ dueAt: null });
  });

  it("carries asset hints as labels and rejects a blank one", () => {
    const action = generalActionSchema.parse({
      id: "a1",
      ownerUserId: "user-1",
      title: "Replace the refrigerator water filter",
      assetHints: [{ label: "refrigerator water filter" }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(action.assetHints).toEqual([{ label: "refrigerator water filter" }]);

    // Absent asset hints default to an empty array, like links.
    const bare = generalActionSchema.parse({
      id: "a2",
      ownerUserId: "user-1",
      title: "Renew the registration",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(bare.assetHints).toEqual([]);

    expect(() => generalActionAssetHintSchema.parse({ label: "   " })).toThrow();
  });

  it("update schema carries scope + household only when explicitly re-scoping", () => {
    // Re-scoping is an explicit patch; an unrelated content update never touches
    // visibility, so scope/householdId stay absent unless named.
    expect(generalActionUpdateSchema.parse({ title: "New title" })).not.toHaveProperty("scope");
    const rescope = generalActionUpdateSchema.parse({
      scope: "household",
      householdId: "hh-1",
      lastActorUserId: "user-1",
    });
    expect(rescope).toMatchObject({ scope: "household", householdId: "hh-1" });
  });

  it("distinguishes an omitted edit field from an explicit clear", () => {
    const edit = generalActionEditSchema.parse({ notes: null, dueAt: null });
    expect(edit).toHaveProperty("notes", null);
    expect(edit).toHaveProperty("dueAt", null);
    expect(edit).not.toHaveProperty("title");

    expect(() => generalActionEditSchema.parse({ unknown: true })).toThrow();
  });
});
