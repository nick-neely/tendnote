import { describe, expect, it } from "vitest";
import {
  createSavedItemSchema,
  resolveSavedItemTransition,
  SavedItemValidationError,
  savedItemEditSchema,
} from "./saved-items";

const BASE = {
  ownerUserId: "owner-1",
  kind: "note" as const,
  title: "Filter measurements",
  content: "The refrigerator filter is 8 inches long.",
  sourceRecordId: "source-1",
};

describe("saved item contract", () => {
  it("creates only the fixed kinds with private active defaults and source grounding", () => {
    const item = createSavedItemSchema.parse(BASE);

    expect(item).toMatchObject({
      kind: "note",
      status: "active",
      scope: "private",
      sourceRecordId: "source-1",
      bringBackAt: null,
    });
    expect(() => createSavedItemSchema.parse({ ...BASE, kind: "document" })).toThrow();
    expect(() => createSavedItemSchema.parse({ ...BASE, sourceRecordId: "" })).toThrow();
  });

  it("requires a valid URL for link items and keeps links optional for other kinds", () => {
    expect(
      createSavedItemSchema.parse({
        ...BASE,
        kind: "link",
        title: "Replacement filter",
        url: "https://example.com/filter",
      }).url,
    ).toBe("https://example.com/filter");

    expect(() => createSavedItemSchema.parse({ ...BASE, kind: "link", url: undefined })).toThrow(
      /link/i,
    );
    expect(createSavedItemSchema.parse(BASE).url).toBeNull();
  });

  it("validates bounded edits without rewriting source evidence", () => {
    expect(
      savedItemEditSchema.parse({
        title: "Updated title",
        content: null,
        bringBackAt: new Date("2026-08-01T14:00:00Z"),
      }),
    ).toEqual({
      title: "Updated title",
      content: null,
      bringBackAt: new Date("2026-08-01T14:00:00Z"),
    });
    expect("sourceRecordId" in savedItemEditSchema.parse({ title: "Updated title" })).toBe(false);
  });
});

describe("saved item lifecycle", () => {
  it("archives and reopens ordinary items", () => {
    expect(resolveSavedItemTransition("active", "archive", { resolved: false })).toBe("archived");
    expect(resolveSavedItemTransition("archived", "reopen", { resolved: false })).toBe("active");
  });

  it("only resolves active open questions and keeps resolved items archived", () => {
    expect(resolveSavedItemTransition("active", "resolve", { kind: "open_question" })).toBe(
      "archived",
    );
    expect(() => resolveSavedItemTransition("active", "resolve", { kind: "note" })).toThrow(
      SavedItemValidationError,
    );
    expect(() => resolveSavedItemTransition("archived", "reopen", { resolved: true })).toThrow(
      /resolved/i,
    );
  });
});
