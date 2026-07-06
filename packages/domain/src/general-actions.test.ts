import { describe, expect, it } from "vitest";
import {
  assertGeneralActionEditable,
  assertResurfaceDate,
  generalActionEditSchema,
  generalActionLinkSchema,
  generalActionSchema,
  generalActionUpdateSchema,
  isActiveGeneralActionStatus,
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
});

describe("active + editable status guards", () => {
  it("treats open and deferred as active, terminal states as inactive", () => {
    expect(isActiveGeneralActionStatus("open")).toBe(true);
    expect(isActiveGeneralActionStatus("deferred")).toBe(true);
    expect(isActiveGeneralActionStatus("completed")).toBe(false);
    expect(isActiveGeneralActionStatus("archived")).toBe(false);
  });

  it("blocks editing terminal actions", () => {
    expect(() => assertGeneralActionEditable("open")).not.toThrow();
    expect(() => assertGeneralActionEditable("deferred")).not.toThrow();
    expect(() => assertGeneralActionEditable("completed")).toThrow(/Cannot edit/);
    expect(() => assertGeneralActionEditable("archived")).toThrow(/Cannot edit/);
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

  it("distinguishes an omitted edit field from an explicit clear", () => {
    const edit = generalActionEditSchema.parse({ notes: null, dueAt: null });
    expect(edit).toHaveProperty("notes", null);
    expect(edit).toHaveProperty("dueAt", null);
    expect(edit).not.toHaveProperty("title");

    expect(() => generalActionEditSchema.parse({ unknown: true })).toThrow();
  });
});
