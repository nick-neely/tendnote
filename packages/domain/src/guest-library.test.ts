import { describe, expect, it } from "vitest";
import { type GuestLibraryCandidate, toGuestLibraryRecords } from "./guest-library";

function candidate(overrides: Partial<GuestLibraryCandidate>): GuestLibraryCandidate {
  return {
    id: "record-1",
    title: "Bleed the radiators",
    context: null,
    body: null,
    belongsTo: "Mara",
    date: null,
    scope: "household",
    householdNative: false,
    viewerIsOwner: false,
    ...overrides,
  };
}

describe("the Household Guest gate", () => {
  it.each([
    [{ householdNative: true, belongsTo: null }, "household_native"],
    [{ scope: "household" as const }, "household_scope"],
    [{ scope: "shared" as const }, "shared_scope"],
  ])("keeps %o as %s", (overrides, reason) => {
    expect(toGuestLibraryRecords([candidate(overrides)])).toEqual([
      expect.objectContaining({ id: "record-1", reason }),
    ]);
  });

  it.each([
    { scope: "private" as const },
    { scope: "shared" as const, viewerIsOwner: true },
    { scope: "household" as const, viewerIsOwner: true },
  ])("drops %o", (overrides) => {
    expect(toGuestLibraryRecords([candidate(overrides)])).toEqual([]);
  });

  it("carries no visibility facts past the gate", () => {
    const [record] = toGuestLibraryRecords([candidate({})]);
    expect(Object.keys(record ?? {}).sort()).toEqual(
      ["belongsTo", "body", "context", "date", "id", "reason", "title"].sort(),
    );
  });
});
