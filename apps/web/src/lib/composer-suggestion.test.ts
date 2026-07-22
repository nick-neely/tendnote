import { describe, expect, it } from "vitest";
import { suggestComposerPerson } from "./composer-suggestion";

describe("suggestComposerPerson", () => {
  it("prefers the person behind the soonest active reminder", () => {
    expect(
      suggestComposerPerson(
        [{ personName: "Mara" }, { personName: "Sam" }],
        [{ displayName: "Ada" }],
      ),
    ).toBe("Mara");
  });

  it("skips reminders that name no person", () => {
    expect(
      suggestComposerPerson(
        [{ personName: null }, { personName: "Sam" }],
        [{ displayName: "Ada" }],
      ),
    ).toBe("Sam");
  });

  it("falls back to the directory when no reminder names anyone", () => {
    expect(suggestComposerPerson([{ personName: null }], [{ displayName: "Ada" }])).toBe("Ada");
  });

  it("returns null for an empty notebook so the composer stays name-free", () => {
    expect(suggestComposerPerson([], [])).toBeNull();
  });
});
