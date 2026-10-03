import type { GuestLibrary, GuestLibraryRecord } from "@tendnote/domain/guest-library";
import { describe, expect, it } from "vitest";
import {
  guestLibraryHref,
  guestReasonCopy,
  orderedRecords,
  selectGuestShelf,
} from "./guest-library-view";

function record(overrides: Partial<GuestLibraryRecord>): GuestLibraryRecord {
  return {
    id: "r",
    title: "A record",
    context: null,
    body: null,
    belongsTo: "Mara",
    reason: "household_scope",
    date: null,
    ...overrides,
  };
}

const library: GuestLibrary = {
  householdName: "Rivera House",
  shelves: [
    { domain: "people", records: [], unavailable: false },
    { domain: "memories", records: [record({ id: "m1" })], unavailable: false },
  ],
};

describe("choosing a shelf and record", () => {
  it("opens the requested shelf and record", () => {
    const { shelf, record: chosen } = selectGuestShelf(library, {
      shelf: "memories",
      record: "m1",
    });
    expect(shelf.domain).toBe("memories");
    expect(chosen?.id).toBe("m1");
  });

  it("falls back to the first shelf with something on it, and to no record", () => {
    for (const params of [{}, { shelf: "toString" }, { shelf: "nonsense", record: "gone" }]) {
      const { shelf, record: chosen } = selectGuestShelf(library, params);
      expect(shelf.domain).toBe("memories");
      expect(chosen).toBeNull();
    }
  });

  it("opens an empty requested shelf rather than skipping it", () => {
    expect(selectGuestShelf(library, { shelf: "people" }).shelf.domain).toBe("people");
  });

  it("links by shelf and record", () => {
    expect(guestLibraryHref("memories", "m 1")).toBe("/guest?shelf=memories&record=m+1");
  });
});

describe("ordering a shelf", () => {
  const dated = (id: string, iso: string | null) =>
    record({ id, date: iso ? new Date(iso) : null });

  it("reads upcoming things soonest first, undated last", () => {
    const shelf = {
      domain: "followUps" as const,
      unavailable: false,
      records: [dated("later", "2026-12-01"), dated("none", null), dated("soon", "2026-10-05")],
    };
    expect(orderedRecords(shelf).map((r) => r.id)).toEqual(["soon", "later", "none"]);
  });

  it("reads recorded things newest first", () => {
    const shelf = {
      domain: "memories" as const,
      unavailable: false,
      records: [dated("old", "2026-01-01"), dated("new", "2026-09-01")],
    };
    expect(orderedRecords(shelf).map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("saying why a record is visible", () => {
  it.each([
    [record({ reason: "shared_scope" }), "memories", "Mara shared it with you."],
    [record({ reason: "household_scope" }), "assets", "Mara shared it with the whole household."],
    [
      record({ reason: "household_native", belongsTo: null }),
      "generalActions",
      "It belongs to the household, so every member can read it.",
    ],
    [
      record({ reason: "household_native", belongsTo: null }),
      "people",
      "They are a member of this household.",
    ],
  ] as const)("%o on %s", (input, domain, copy) => {
    expect(guestReasonCopy(domain, input)).toBe(copy);
  });
});
