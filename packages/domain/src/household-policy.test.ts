import { describe, expect, it } from "vitest";
import {
  assertHouseholdAdmissionAvailable,
  assertHouseholdSeatAvailable,
  HOUSEHOLD_NAME_LIMIT,
  HOUSEHOLD_SEAT_LIMIT,
  HouseholdAdmissionConflictError,
  HouseholdValidationError,
  householdSeatUsage,
  parseHouseholdName,
} from "./household-policy";

describe("household name", () => {
  it("keeps the name the user typed, trimmed", () => {
    expect(parseHouseholdName("  The Neely house  ")).toBe("The Neely house");
  });

  it("asks for a name instead of creating an unnamed household", () => {
    expect(() => parseHouseholdName("   ")).toThrow(HouseholdValidationError);
    expect(() => parseHouseholdName("   ")).toThrow("Give the household a name.");
  });

  /** The limit a surface bounds its input by is the one the schema enforces. */
  it("keeps the name short enough to lead a screen", () => {
    expect(HOUSEHOLD_NAME_LIMIT).toBe(60);
    expect(parseHouseholdName("x".repeat(HOUSEHOLD_NAME_LIMIT))).toHaveLength(HOUSEHOLD_NAME_LIMIT);
    expect(() => parseHouseholdName("x".repeat(HOUSEHOLD_NAME_LIMIT + 1))).toThrow(
      "Keep the household name to 60 characters or fewer.",
    );
  });
});

describe("household admission", () => {
  it("admits a user who is not active anywhere", () => {
    expect(() => assertHouseholdAdmissionAvailable([])).not.toThrow();
  });

  /**
   * The conflict is explained without naming the other household: the message a
   * caller may render must not disclose a workspace, its name, or its members.
   */
  it("refuses a second active workspace without disclosing the first", () => {
    const conflict = () => assertHouseholdAdmissionAvailable([{ householdId: "household-1" }]);

    expect(conflict).toThrow(HouseholdAdmissionConflictError);
    expect(conflict).toThrow(
      "You're already in a household. Tendnote keeps you in one household at a time, so nothing here has changed.",
    );
    try {
      conflict();
    } catch (error) {
      expect((error as Error).message).not.toContain("household-1");
    }
  });

  it("is a curated validation failure, so surfaces can render it inline", () => {
    expect(new HouseholdAdmissionConflictError("x")).toBeInstanceOf(HouseholdValidationError);
  });
});

describe("household seat policy", () => {
  it("counts active members and live invitations against one seat limit", () => {
    expect(householdSeatUsage({ activeMembers: 1 })).toEqual({
      limit: HOUSEHOLD_SEAT_LIMIT,
      occupied: 1,
      remaining: 7,
      isFull: false,
    });
    expect(householdSeatUsage({ activeMembers: 6, liveInvitations: 2 })).toEqual({
      limit: 8,
      occupied: 8,
      remaining: 0,
      isFull: true,
    });
  });

  it("never reports negative remaining capacity", () => {
    expect(householdSeatUsage({ activeMembers: 9 })).toMatchObject({
      occupied: 9,
      remaining: 0,
      isFull: true,
    });
  });

  it("blocks one more occupant only when the household is full", () => {
    expect(() => assertHouseholdSeatAvailable({ activeMembers: 7 })).not.toThrow();
    expect(() => assertHouseholdSeatAvailable({ activeMembers: 8 })).toThrow(
      HouseholdValidationError,
    );
    expect(() => assertHouseholdSeatAvailable({ activeMembers: 8 })).toThrow(
      "This household is full. It holds up to 8 people, counting anyone with a live invitation.",
    );
  });
});
