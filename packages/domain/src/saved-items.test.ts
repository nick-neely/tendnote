import { describe, expect, it } from "vitest";
import {
  assertMemberOwnedSavedItem,
  assertSavedItemVersion,
  createSavedItemSchema,
  resolveSavedItemTransition,
  SavedItemConflictError,
  SavedItemValidationError,
  savedItemEditSchema,
  savedItemSchema,
  savedItemUpdateSchema,
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

describe("saved item ownership form", () => {
  const HOUSEHOLD_NATIVE = {
    kind: "note" as const,
    title: "Boiler engineer",
    sourceRecordId: "source-1",
    ownership: "household_native" as const,
    ownerUserId: null,
    scope: "household" as const,
    householdId: "household-1",
    createdByUserId: "ana",
  };

  it("defaults to member-owned so nothing becomes the household's by omission", () => {
    expect(createSavedItemSchema.parse(BASE)).toMatchObject({
      ownership: "member_owned",
      ownerUserId: "owner-1",
      version: 1,
    });
  });

  it("accepts a workspace-owned item with no member owner and full household visibility", () => {
    expect(createSavedItemSchema.parse(HOUSEHOLD_NATIVE)).toMatchObject({
      ownership: "household_native",
      ownerUserId: null,
      scope: "household",
      createdByUserId: "ana",
    });
  });

  it("refuses a member-owned item with no owner", () => {
    expect(() => createSavedItemSchema.parse({ ...BASE, ownerUserId: null })).toThrow(
      /needs an owner/,
    );
  });

  it.each([
    // A member id left on a workspace-owned record reads back as authority.
    [{ ownerUserId: "ana" }, /belongs to the household/],
    // A scope narrower than its authority is a state the proof cannot express.
    [{ scope: "shared" as const }, /visible to the whole household/],
    [{ householdId: null }, /needs a household/],
    // Attribution is not authority, but it is still required.
    [{ createdByUserId: null }, /records who created it/],
  ])("refuses a malformed household-native item (%#)", (override, message) => {
    expect(() => createSavedItemSchema.parse({ ...HOUSEHOLD_NATIVE, ...override })).toThrow(
      message,
    );
  });
});

describe("no conversion path between the ownership forms", () => {
  // The update schema is `.strict()` and names neither field. That is the whole
  // mechanism: there is no patch any adapter can build that hands a member's
  // Saved Item to the household or claims a household one back, so widening
  // visibility can never quietly become a transfer of ownership (ADR 0214).
  it.each([
    ["ownership", { ownership: "household_native" }],
    ["ownerUserId", { ownerUserId: "someone-else" }],
    ["version", { version: 99 }],
    ["createdByUserId", { createdByUserId: "someone-else" }],
  ])("refuses an update that tries to set %s", (_field, patch) => {
    expect(() => savedItemUpdateSchema.parse(patch)).toThrow();
  });

  it("still accepts the visibility fields a re-scope legitimately changes", () => {
    expect(savedItemUpdateSchema.parse({ scope: "household", householdId: "household-1" })).toEqual(
      { scope: "household", householdId: "household-1" },
    );
  });
});

describe("household-native write guards", () => {
  const ITEM = savedItemSchema.parse({
    id: "item-1",
    kind: "note",
    title: "Boiler engineer",
    sourceRecordId: "source-1",
    ownership: "household_native",
    ownerUserId: null,
    scope: "household",
    householdId: "household-1",
    createdByUserId: "ana",
    lastActorUserId: "ben",
    version: 4,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  });

  it("passes a write that matches the version the member was shown", () => {
    expect(() => assertSavedItemVersion(ITEM, 4)).not.toThrow();
  });

  it("treats an omitted version as a deliberate replace rather than a missing check", () => {
    expect(() => assertSavedItemVersion(ITEM, undefined)).not.toThrow();
  });

  it("hands a stale writer the current value and the last actor", () => {
    const conflict = (() => {
      try {
        assertSavedItemVersion(ITEM, 3);
        return null;
      } catch (error) {
        return error as SavedItemConflictError;
      }
    })();

    expect(conflict).toBeInstanceOf(SavedItemConflictError);
    expect(conflict?.current).toMatchObject({
      savedItemId: "item-1",
      version: 4,
      title: "Boiler engineer",
      lastActorUserId: "ben",
    });
    // Factual, and not a telling-off: writing at the same time is nobody's fault.
    expect(conflict?.message).toBe(
      "Someone else changed this while you were writing. Your draft is kept below.",
    );
  });

  it("names archive as a workspace-owned item's removal path", () => {
    expect(() => assertMemberOwnedSavedItem(ITEM, "deleted")).toThrow(/Archiving keeps it/);
    expect(() =>
      assertMemberOwnedSavedItem({ ownership: "member_owned" }, "deleted"),
    ).not.toThrow();
  });
});
