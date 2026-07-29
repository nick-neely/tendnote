import type { HouseholdMembership } from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";

/**
 * One fixed instant for every fixture row in this suite. Recall orders equal-strength
 * matches by recency, so a shared clock keeps those tie-breakers decided by the values a
 * test states rather than by when it happened to build its rows.
 */
export const now = new Date("2026-06-26T00:00:00Z");

/**
 * The one household the visibility cases seed against. Memberships and shares only mean
 * anything relative to each other, so they all anchor here unless a case deliberately
 * names a second household to test the boundary between them.
 */
export const HOUSEHOLD_ID = "99999999-9999-4999-8999-999999999999";

/**
 * An active membership, keyed by user so several can be seeded side by side without
 * colliding on id. Active is the default because the interesting rows are the ones that
 * override it: a `removed` member is how these tests ask whether visibility is decided
 * against the live membership on every query rather than frozen when the record was shared.
 */
export function householdMembership(
  overrides: Partial<HouseholdMembership> = {},
): HouseholdMembership {
  return {
    id: `membership-${overrides.userId ?? "user"}`,
    householdId: HOUSEHOLD_ID,
    userId: "member-1",
    invitedByUserId: "owner-1",
    role: "member",
    status: "active",
    invitedAt: now,
    acceptedAt: now,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * A share of one specific record with one specific person.
 *
 * `recordKind` and `recordId` are required rather than defaulted: a share says nothing
 * except against a named record, and the suites that seed these disagree about which kind
 * is the usual one - a default would read as harmless and be silently wrong in one of them.
 */
export function householdRecordShare(
  overrides: Pick<HouseholdRecordShare, "recordKind" | "recordId"> & Partial<HouseholdRecordShare>,
): HouseholdRecordShare {
  return {
    id: `share-${overrides.recordId}`,
    householdId: HOUSEHOLD_ID,
    sharedWithUserId: "member-1",
    sharedByUserId: "owner-1",
    createdAt: now,
    ...overrides,
  };
}
