import { describe, expect, it } from "vitest";
import {
  activeHouseholdOwners,
  assertDepartureAllowed,
  assertDissolutionAllowed,
  assertMemberRemovalAllowed,
  assertOwnerPromotionAllowed,
  assertOwnerStepDownAllowed,
  departureRefusal,
  dissolutionRefusal,
  HOUSEHOLD_RECOVERY_WINDOW_DAYS,
  type HouseholdRoster,
  householdDissolutionProgress,
  householdPurgeCutoff,
  householdRecoveryDeadline,
  isHouseholdPurgeDue,
  memberRemovalRefusal,
  ownerPromotionRefusal,
  ownerStepDownRefusal,
} from "./household-governance";
import { HouseholdValidationError } from "./household-policy";

/**
 * The rosters every case below is decided against. Governance is a function of
 * who is active and what role they hold, so the matrix is written as rosters
 * rather than as one household mutated through a sequence.
 */
const SOLE_OWNER: HouseholdRoster = [{ userId: "ana", role: "owner", status: "active" }];

const OWNER_AND_MEMBER: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "member", status: "active" },
];

const TWO_OWNERS: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "owner", status: "active" },
];

const OWNER_AND_OFFERED_MEMBER: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "member", status: "active", pendingRole: "owner" },
];

/** A removed row must never count toward a rule that protects the household. */
const OWNER_AND_REMOVED_OWNER: HouseholdRoster = [
  { userId: "ana", role: "owner", status: "active" },
  { userId: "ben", role: "owner", status: "removed" },
];

describe("roster reading", () => {
  it("counts only active owners", () => {
    expect(activeHouseholdOwners(OWNER_AND_REMOVED_OWNER).map((owner) => owner.userId)).toEqual([
      "ana",
    ]);
    expect(activeHouseholdOwners(TWO_OWNERS)).toHaveLength(2);
    expect(activeHouseholdOwners(OWNER_AND_MEMBER)).toHaveLength(1);
  });
});

describe("promotion to co-owner", () => {
  it("is available for an active member who has not been asked", () => {
    expect(
      ownerPromotionRefusal({
        roster: OWNER_AND_MEMBER,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).toBeNull();
  });

  it("refuses a second offer while one is outstanding", () => {
    expect(
      ownerPromotionRefusal({
        roster: OWNER_AND_OFFERED_MEMBER,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).toMatch(/already been asked/i);
  });

  it("refuses someone who is already an owner, and refuses the actor themselves", () => {
    expect(
      ownerPromotionRefusal({ roster: TWO_OWNERS, actorUserId: "ana", memberUserId: "ben" }),
    ).toMatch(/already an owner/i);
    expect(
      ownerPromotionRefusal({ roster: TWO_OWNERS, actorUserId: "ana", memberUserId: "ana" }),
    ).toMatch(/already an owner/i);
  });

  it("refuses someone who is not an active member of this household", () => {
    expect(
      ownerPromotionRefusal({
        roster: OWNER_AND_REMOVED_OWNER,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).toMatch(/no longer/i);
    expect(
      ownerPromotionRefusal({
        roster: OWNER_AND_MEMBER,
        actorUserId: "ana",
        memberUserId: "stranger",
      }),
    ).toMatch(/no longer/i);
  });

  it("raises the curated message when asserted", () => {
    expect(() =>
      assertOwnerPromotionAllowed({
        roster: TWO_OWNERS,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).toThrow(HouseholdValidationError);
    expect(() =>
      assertOwnerPromotionAllowed({
        roster: OWNER_AND_MEMBER,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).not.toThrow();
  });
});

describe("member removal", () => {
  it("lets an owner remove an active member", () => {
    expect(
      memberRemovalRefusal({ roster: OWNER_AND_MEMBER, actorUserId: "ana", memberUserId: "ben" }),
    ).toBeNull();
  });

  /** The protected-co-owner rule, which is the whole point of ADR 0213. */
  it("never lets one owner remove another owner", () => {
    expect(
      memberRemovalRefusal({ roster: TWO_OWNERS, actorUserId: "ana", memberUserId: "ben" }),
    ).toMatch(/can't remove another owner/i);
    expect(() =>
      assertMemberRemovalAllowed({ roster: TWO_OWNERS, actorUserId: "ana", memberUserId: "ben" }),
    ).toThrow(HouseholdValidationError);
  });

  it("sends the actor to departure rather than removing themselves", () => {
    expect(
      memberRemovalRefusal({ roster: OWNER_AND_MEMBER, actorUserId: "ana", memberUserId: "ana" }),
    ).toMatch(/leaving is yours to do/i);
  });

  it("refuses someone who is already gone", () => {
    expect(
      memberRemovalRefusal({
        roster: OWNER_AND_REMOVED_OWNER,
        actorUserId: "ana",
        memberUserId: "ben",
      }),
    ).toMatch(/no longer/i);
  });
});

describe("voluntary departure", () => {
  it("lets a member leave", () => {
    expect(departureRefusal({ roster: OWNER_AND_MEMBER, userId: "ben" })).toBeNull();
  });

  it("lets an owner leave while another active owner remains", () => {
    expect(departureRefusal({ roster: TWO_OWNERS, userId: "ana" })).toBeNull();
  });

  it("holds the last owner of a household that still has people in it", () => {
    const refusal = departureRefusal({ roster: OWNER_AND_MEMBER, userId: "ana" });
    expect(refusal).toMatch(/only owner/i);
    // The concrete recovery, named at the blocked action (setup UX contract).
    expect(refusal).toMatch(/accept/i);
    expect(() => assertDepartureAllowed({ roster: OWNER_AND_MEMBER, userId: "ana" })).toThrow(
      HouseholdValidationError,
    );
  });

  it("tells a sole member that ending the household is the way out", () => {
    expect(departureRefusal({ roster: SOLE_OWNER, userId: "ana" })).toMatch(/only person/i);
  });

  it("refuses someone who is not in the household", () => {
    expect(departureRefusal({ roster: OWNER_AND_MEMBER, userId: "stranger" })).toMatch(
      /no longer/i,
    );
  });
});

describe("stepping down from owner", () => {
  it("is allowed while another active owner remains", () => {
    expect(ownerStepDownRefusal({ roster: TWO_OWNERS, userId: "ana" })).toBeNull();
  });

  it("is refused for the last active owner", () => {
    expect(ownerStepDownRefusal({ roster: OWNER_AND_MEMBER, userId: "ana" })).toMatch(
      /only owner/i,
    );
    expect(() => assertOwnerStepDownAllowed({ roster: OWNER_AND_MEMBER, userId: "ana" })).toThrow(
      HouseholdValidationError,
    );
  });

  it("is not offered to someone who is not an owner", () => {
    expect(ownerStepDownRefusal({ roster: OWNER_AND_MEMBER, userId: "ben" })).toMatch(
      /not an owner/i,
    );
  });
});

describe("dissolution", () => {
  it("is an owner decision", () => {
    expect(dissolutionRefusal({ roster: OWNER_AND_MEMBER, userId: "ana" })).toBeNull();
    expect(dissolutionRefusal({ roster: OWNER_AND_MEMBER, userId: "ben" })).toMatch(
      /only an owner/i,
    );
    expect(() => assertDissolutionAllowed({ roster: OWNER_AND_MEMBER, userId: "ben" })).toThrow(
      HouseholdValidationError,
    );
  });

  it("completes on one confirmation when there is one owner", () => {
    const progress = householdDissolutionProgress({
      roster: OWNER_AND_MEMBER,
      confirmedOwnerUserIds: ["ana"],
    });
    expect(progress).toMatchObject({ required: 1, confirmed: 1, unanimous: true });
    expect(progress.awaitingUserIds).toEqual([]);
  });

  it("waits for every active owner", () => {
    const partial = householdDissolutionProgress({
      roster: TWO_OWNERS,
      confirmedOwnerUserIds: ["ana"],
    });
    expect(partial).toMatchObject({ required: 2, confirmed: 1, unanimous: false });
    expect(partial.awaitingUserIds).toEqual(["ben"]);

    expect(
      householdDissolutionProgress({ roster: TWO_OWNERS, confirmedOwnerUserIds: ["ana", "ben"] }),
    ).toMatchObject({ unanimous: true });
  });

  /**
   * A confirmation from someone who has since stopped being an active owner is
   * not unanimity. Counting it would let a household be ended by a quorum that
   * no longer exists.
   */
  it("ignores confirmations from anyone who is no longer an active owner", () => {
    expect(
      householdDissolutionProgress({
        roster: OWNER_AND_REMOVED_OWNER,
        confirmedOwnerUserIds: ["ben"],
      }),
    ).toMatchObject({ required: 1, confirmed: 0, unanimous: false });

    expect(
      householdDissolutionProgress({
        roster: OWNER_AND_MEMBER,
        confirmedOwnerUserIds: ["ben"],
      }),
    ).toMatchObject({ required: 1, confirmed: 0, unanimous: false });
  });

  it("never reads as unanimous with no active owners at all", () => {
    expect(householdDissolutionProgress({ roster: [], confirmedOwnerUserIds: [] })).toMatchObject({
      required: 0,
      confirmed: 0,
      unanimous: false,
    });
  });
});

describe("the recovery boundary", () => {
  it("puts the deadline a fixed window after dissolution", () => {
    const dissolvedAt = new Date("2026-08-08T12:00:00Z");
    expect(householdRecoveryDeadline(dissolvedAt).toISOString()).toBe("2026-09-07T12:00:00.000Z");
    expect(HOUSEHOLD_RECOVERY_WINDOW_DAYS).toBe(30);
  });

  it("holds a household back until its deadline has actually passed", () => {
    const dissolvedAt = new Date("2026-08-08T12:00:00Z");
    const deadline = householdRecoveryDeadline(dissolvedAt);

    expect(isHouseholdPurgeDue({ dissolvedAt, now: new Date(deadline.getTime() - 1) })).toBe(false);
    expect(isHouseholdPurgeDue({ dissolvedAt, now: deadline })).toBe(true);
    expect(isHouseholdPurgeDue({ dissolvedAt, now: new Date(deadline.getTime() + 1) })).toBe(true);
  });

  it("never purges a household that has no dissolution moment to count from", () => {
    expect(isHouseholdPurgeDue({ dissolvedAt: null, now: new Date("2099-01-01T00:00:00Z") })).toBe(
      false,
    );
  });

  it("selects by the same boundary from the other end, so the index can do the filtering", () => {
    const now = new Date("2026-09-07T12:00:00Z");
    const cutoff = householdPurgeCutoff(now);

    // A household is due exactly when it dissolved at or before the cutoff, so
    // `dissolved_at <= cutoff` and `deadline <= now` must never disagree.
    for (const offsetMs of [-1, 0, 1]) {
      const dissolvedAt = new Date(cutoff.getTime() + offsetMs);
      expect(isHouseholdPurgeDue({ dissolvedAt, now })).toBe(dissolvedAt <= cutoff);
    }
  });
});
