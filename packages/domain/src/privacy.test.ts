import { describe, expect, it } from "vitest";
import {
  canViewScopedRecord,
  scopedRecordVisibility,
  scopeForVisibilityChoice,
  VISIBILITY_CONTROL_OPTIONS,
  visibilityStatusLabel,
} from "./privacy";

describe("household visibility policy", () => {
  const HOUSEHOLD = "household-1";
  const OWNER = "owner-user";
  const MEMBER = "member-user";
  const OTHER_MEMBER = "other-member-user";
  const REMOVED_MEMBER = "removed-member-user";

  const activeMemberships = [
    { householdId: HOUSEHOLD, userId: OWNER },
    { householdId: HOUSEHOLD, userId: MEMBER },
    { householdId: HOUSEHOLD, userId: OTHER_MEMBER },
  ];

  it("exposes the simple visibility choices without ACL vocabulary", () => {
    expect(VISIBILITY_CONTROL_OPTIONS.map((option) => option.label)).toEqual([
      "Only me",
      "Specific people",
      "Whole household",
    ]);
    expect(scopeForVisibilityChoice("only_me")).toBe("private");
    expect(scopeForVisibilityChoice("selected_members")).toBe("shared");
    expect(scopeForVisibilityChoice("whole_household")).toBe("household");
  });

  it("names a read-only audience in the same language as the editor, with an explicit count", () => {
    expect(visibilityStatusLabel({ scope: "private" })).toBe("Only me");
    expect(visibilityStatusLabel({ scope: "shared", selectedCount: 0 })).toBe("Specific people");
    expect(visibilityStatusLabel({ scope: "shared", selectedCount: 1 })).toBe(
      "Shared with 1 person",
    );
    expect(visibilityStatusLabel({ scope: "shared", selectedCount: 2 })).toBe(
      "Shared with 2 people",
    );
    expect(visibilityStatusLabel({ scope: "household" })).toBe("Whole household");
  });

  it("keeps private records visible only to the owner, not household owners by role", () => {
    const record = {
      ownerUserId: MEMBER,
      scope: "private" as const,
      householdId: HOUSEHOLD,
    };

    expect(canViewScopedRecord({ callerUserId: MEMBER, record, activeMemberships })).toBe(true);
    expect(canViewScopedRecord({ callerUserId: OWNER, record, activeMemberships })).toBe(false);
  });

  it("limits selected-member shared records to the owner and explicitly selected active members", () => {
    const record = scopedRecordVisibility({
      ownerUserId: OWNER,
      scope: "shared",
      householdId: HOUSEHOLD,
      shares: [{ sharedWithUserId: MEMBER }],
    });

    expect(canViewScopedRecord({ callerUserId: OWNER, record, activeMemberships })).toBe(true);
    expect(canViewScopedRecord({ callerUserId: MEMBER, record, activeMemberships })).toBe(true);
    expect(canViewScopedRecord({ callerUserId: OTHER_MEMBER, record, activeMemberships })).toBe(
      false,
    );
  });

  it("makes household records visible to current and future active household members", () => {
    const record = {
      ownerUserId: OWNER,
      scope: "household" as const,
      householdId: HOUSEHOLD,
    };
    const futureMemberships = [...activeMemberships, { householdId: HOUSEHOLD, userId: "future" }];

    expect(canViewScopedRecord({ callerUserId: OTHER_MEMBER, record, activeMemberships })).toBe(
      true,
    );
    expect(
      canViewScopedRecord({ callerUserId: "future", record, activeMemberships: futureMemberships }),
    ).toBe(true);
  });

  it("revokes removed members from shared and household records", () => {
    const shared = {
      ownerUserId: OWNER,
      scope: "shared" as const,
      householdId: HOUSEHOLD,
      sharedWithUserIds: [REMOVED_MEMBER],
    };
    const household = {
      ownerUserId: OWNER,
      scope: "household" as const,
      householdId: HOUSEHOLD,
    };

    expect(
      canViewScopedRecord({ callerUserId: REMOVED_MEMBER, record: shared, activeMemberships }),
    ).toBe(false);
    expect(
      canViewScopedRecord({ callerUserId: REMOVED_MEMBER, record: household, activeMemberships }),
    ).toBe(false);
  });

  it("rejects shared and household records that are not anchored to a household", () => {
    const record = {
      ownerUserId: OWNER,
      scope: "shared" as const,
      householdId: null,
      sharedWithUserIds: [MEMBER],
    };

    expect(canViewScopedRecord({ callerUserId: MEMBER, record, activeMemberships })).toBe(false);
  });
});
