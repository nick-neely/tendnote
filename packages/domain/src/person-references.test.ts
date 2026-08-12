import { describe, expect, it } from "vitest";
import {
  normalizePersonReferenceLabel,
  PERSON_REFERENCE_CONTACT_DETAIL_MESSAGE,
  PERSON_REFERENCE_LABEL_MAX_LENGTH,
  personReferenceSchema,
} from "./person-references";

describe("normalizePersonReferenceLabel", () => {
  it("keeps a plain name", () => {
    expect(normalizePersonReferenceLabel("Dr. Alvarez")).toBe("Dr. Alvarez");
  });

  it("trims and collapses whitespace so one label is one label", () => {
    expect(normalizePersonReferenceLabel("  Dr.\t Alvarez \n")).toBe("Dr. Alvarez");
  });

  it("refuses an empty label", () => {
    expect(() => normalizePersonReferenceLabel("   ")).toThrow();
  });

  it("refuses a label longer than the cap", () => {
    expect(() =>
      normalizePersonReferenceLabel("a".repeat(PERSON_REFERENCE_LABEL_MAX_LENGTH + 1)),
    ).toThrow();
  });

  it("refuses contact details, so a reference cannot become an address book", () => {
    for (const contactDetail of [
      "alvarez@example.com",
      "+1 (555) 010-4477",
      "5550104477",
      "https://example.com/alvarez",
    ]) {
      expect(() => normalizePersonReferenceLabel(contactDetail)).toThrow(
        PERSON_REFERENCE_CONTACT_DETAIL_MESSAGE,
      );
    }
  });

  it("allows an ordinary name that happens to carry a digit", () => {
    expect(normalizePersonReferenceLabel("Sam the 2nd")).toBe("Sam the 2nd");
  });
});

describe("personReferenceSchema", () => {
  const reference = {
    id: "reference-1",
    householdId: "household-1",
    recordKind: "general_action" as const,
    recordId: "action-1",
    label: "Dr. Alvarez",
    createdByUserId: "user-1",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
  };

  it("parses a record-local reference", () => {
    expect(personReferenceSchema.parse(reference).label).toBe("Dr. Alvarez");
  });

  it("retains a record-local name after its creator account is gone", () => {
    expect(
      personReferenceSchema.parse({ ...reference, createdByUserId: null }).createdByUserId,
    ).toBeNull();
  });

  /**
   * The structural guarantee behind acceptance criterion three. A Person
   * Reference that could hold a person id would be one join away from another
   * member's private People graph, so the shape must refuse to carry one.
   */
  it("has no field that could point at a Person record", () => {
    expect(Object.keys(personReferenceSchema.shape)).not.toContain("personId");
    const parsed = personReferenceSchema.parse({ ...reference, personId: "person-1" });
    expect(JSON.stringify(parsed)).not.toContain("person-1");
  });

  it("normalizes the label on the way in", () => {
    expect(personReferenceSchema.parse({ ...reference, label: "  Dr.  Alvarez " }).label).toBe(
      "Dr. Alvarez",
    );
  });
});
