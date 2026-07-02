import { describe, expect, it } from "vitest";
import {
  birthdaySchema,
  contactMethodSchema,
  normalizeEmailContactValue,
  normalizePhoneContactValue,
  updatePersonSchema,
} from "./people";

describe("contact import profile foundations", () => {
  it("supports month/day-only birthdays without fake year coercion", () => {
    expect(birthdaySchema.parse("--03-14")).toBe("--03-14");
    expect(updatePersonSchema.parse({ birthday: "--12-01" }).birthday).toBe("--12-01");
    expect(() => birthdaySchema.parse("--02-30")).toThrow();
    expect(() => birthdaySchema.parse("1900-02-30")).toThrow();
  });

  it("keeps display and normalized contact values separate", () => {
    const parsed = contactMethodSchema.parse({
      id: "cm-1",
      personId: "p1",
      type: "phone",
      value: "+1 (555) 123-4567",
      displayValue: "(555) 123-4567",
      normalizedValue: "+15551234567",
      isPrimary: true,
      source: "google_contacts",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(parsed.displayValue).toBe("(555) 123-4567");
    expect(parsed.normalizedValue).toBe("+15551234567");
  });

  it("normalizes email values for owner-wide matching", () => {
    expect(normalizeEmailContactValue("  Casey@Example.COM ")).toBe("casey@example.com");
  });

  it("normalizes only confident phone numbers for strong matching", () => {
    expect(normalizePhoneContactValue("(555) 123-4567")).toEqual({
      normalizedValue: null,
      confidence: "ambiguous",
    });
    expect(normalizePhoneContactValue("+1 (555) 123-4567")).toEqual({
      normalizedValue: "+15551234567",
      confidence: "strong",
    });
    expect(normalizePhoneContactValue("12345")).toEqual({
      normalizedValue: null,
      confidence: "ambiguous",
    });
  });
});
