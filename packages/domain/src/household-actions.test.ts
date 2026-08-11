import { describe, expect, it } from "vitest";
import {
  assertGeneralActionOperationForm,
  assertHouseholdNativeFilingAllowed,
  assertResponsibilityHolder,
  describeProgressReconciliation,
  type GeneralActionAuthorityOperation,
  householdOperationForGeneralAction,
  isPersonallyRelevantHouseholdRecord,
  responsibilityHolderLabel,
  shouldOfferResponsibilityHandoff,
} from "./household-actions";
import { evaluateHouseholdAuthorization } from "./household-authorization";

const OWNER = "user-owner";
const MEMBER = "user-member";
const HOUSEHOLD = "household-1";
const MEMBERSHIPS = [
  { householdId: HOUSEHOLD, userId: OWNER },
  { householdId: HOUSEHOLD, userId: MEMBER },
];

/**
 * The authority table from
 * `docs/phase-8/shared-household-actions-and-reminders.md`, asserted through the
 * proof rather than restated as a lookup — the mapping is the thing under test,
 * and a table that agreed with itself would prove nothing.
 */
function memberMay(
  operation: GeneralActionAuthorityOperation,
  ownership: "member_owned" | "household_native",
) {
  try {
    assertGeneralActionOperationForm({ operation, ownership });
  } catch {
    return false;
  }
  return evaluateHouseholdAuthorization({
    callerUserId: MEMBER,
    operation: householdOperationForGeneralAction(operation),
    subject: {
      kind: "general_action",
      id: "action-1",
      ownerUserId: OWNER,
      scope: "household",
      householdId: HOUSEHOLD,
      ownership,
    },
    callerActiveMemberships: MEMBERSHIPS,
  }).authorized;
}

describe("authority over a shared Action, by ownership form", () => {
  it("gives a collaborator only the reversible progress actions on a member-owned record", () => {
    expect(memberMay("view", "member_owned")).toBe(true);
    expect(memberMay("progress", "member_owned")).toBe(true);

    for (const operation of ["edit", "skip", "defer", "archive", "audience", "people"] as const) {
      expect(memberMay(operation, "member_owned")).toBe(false);
    }
  });

  it("gives every active member symmetric authority over a household-native record", () => {
    for (const operation of [
      "view",
      "edit",
      "progress",
      "skip",
      "defer",
      "archive",
      "responsibility",
    ] as const) {
      expect(memberMay(operation, "household_native")).toBe(true);
    }
  });

  it("has no audience to change and no personal filing to hold once the household owns it", () => {
    expect(memberMay("audience", "household_native")).toBe(false);
    expect(memberMay("people", "household_native")).toBe(false);
    expect(() =>
      assertHouseholdNativeFilingAllowed({ ownership: "household_native", areaId: "area-1" }),
    ).toThrow(/Areas are personal/);
    expect(() =>
      assertHouseholdNativeFilingAllowed({ ownership: "member_owned", areaId: "area-1" }),
    ).not.toThrow();
  });

  it("records a household-native grant as household authority, never as ownership", () => {
    const proof = evaluateHouseholdAuthorization({
      callerUserId: OWNER,
      operation: "update",
      subject: {
        kind: "general_action",
        id: "action-1",
        // The creator, who is also this row's storage key — and still holds no
        // more than the other member does.
        ownerUserId: OWNER,
        scope: "household",
        householdId: HOUSEHOLD,
        ownership: "household_native",
      },
      callerActiveMemberships: MEMBERSHIPS,
    });

    expect(proof).toMatchObject({ authorized: true, via: "household_authority" });
  });

  it("refuses everything to someone whose membership has ended", () => {
    const proof = evaluateHouseholdAuthorization({
      callerUserId: MEMBER,
      operation: "view",
      subject: {
        kind: "general_action",
        id: "action-1",
        ownerUserId: MEMBER,
        scope: "household",
        householdId: HOUSEHOLD,
        ownership: "household_native",
      },
      // They created it, so they are its storage key. Standing is what decides.
      callerActiveMemberships: [],
    });

    expect(proof).toMatchObject({ authorized: false, denial: "not_active_member" });
  });
});

describe("the Responsibility Holder", () => {
  it("accepts an active member or nobody, and refuses anyone else", () => {
    const activeMemberUserIds = [OWNER, MEMBER];

    expect(
      assertResponsibilityHolder({
        ownership: "household_native",
        holderUserId: MEMBER,
        activeMemberUserIds,
      }),
    ).toBe(MEMBER);
    expect(
      assertResponsibilityHolder({
        ownership: "household_native",
        holderUserId: null,
        activeMemberUserIds,
      }),
    ).toBeNull();
    expect(() =>
      assertResponsibilityHolder({
        ownership: "household_native",
        holderUserId: "user-stranger",
        activeMemberUserIds,
      }),
    ).toThrow(/currently in this household/);
  });

  it("says who is looking after a record without claiming whose turn it is", () => {
    expect(responsibilityHolderLabel({ holderName: "Ana", isSelf: false })).toBe(
      "Ana is looking after this",
    );
    expect(responsibilityHolderLabel({ holderName: "Ana", isSelf: true })).toBe(
      "You're looking after this",
    );
    // No holder is the ordinary case, so it renders nothing rather than a
    // placeholder that would read as a reproach.
    expect(responsibilityHolderLabel({ holderName: null, isSelf: false })).toBeNull();
  });
});

describe("reconciled progress", () => {
  const handledAt = new Date("2026-08-11T09:00:00Z");

  it("reports what happened without implying the second member did anything wrong", () => {
    const sentence = describeProgressReconciliation(
      { handledAs: "completed", handledByName: "Ben", handledAt },
      () => "on Tuesday",
    );

    expect(sentence).toBe("Ben already marked this done on Tuesday.");
    expect(sentence).not.toMatch(/fail|error|conflict|already done by you|can't|cannot/i);
  });

  it("names a skip as a skip, and copes with an actor it cannot name", () => {
    expect(
      describeProgressReconciliation(
        { handledAs: "skipped", handledByName: "Ben", handledAt },
        () => "on Tuesday",
      ),
    ).toBe("Ben already skipped this one on Tuesday.");
    expect(
      describeProgressReconciliation(
        { handledAs: "skipped", handledByName: null, handledAt },
        () => "on Tuesday",
      ),
    ).toBe("This one was already skipped on Tuesday.");
  });
});

describe("what makes a household record personally relevant", () => {
  const base = {
    memberUserId: MEMBER,
    ownership: "household_native" as const,
    ownerUserId: OWNER,
    scope: "household" as const,
    responsibilityHolderUserId: null,
    hasOwnReminderSchedule: false,
  };

  it("keeps an unheld, unsubscribed household chore off a member's private Today", () => {
    // The intended calm case: it sits on the shared Household home, where the
    // household can see it, and nags nobody privately.
    expect(isPersonallyRelevantHouseholdRecord(base)).toBe(false);
  });

  it("admits it on any one positive signal", () => {
    expect(
      isPersonallyRelevantHouseholdRecord({ ...base, responsibilityHolderUserId: MEMBER }),
    ).toBe(true);
    expect(isPersonallyRelevantHouseholdRecord({ ...base, hasOwnReminderSchedule: true })).toBe(
      true,
    );
    expect(
      isPersonallyRelevantHouseholdRecord({
        ...base,
        ownership: "member_owned",
        ownerUserId: MEMBER,
      }),
    ).toBe(true);
  });

  it("never treats a household-native record's storage key as an ownership signal", () => {
    expect(
      isPersonallyRelevantHouseholdRecord({ ...base, memberUserId: OWNER, ownerUserId: OWNER }),
    ).toBe(false);
  });

  it("leaves a private record alone", () => {
    expect(
      isPersonallyRelevantHouseholdRecord({
        ...base,
        ownership: "member_owned",
        scope: "private",
        ownerUserId: MEMBER,
      }),
    ).toBe(true);
  });
});

describe("how long the hand-off keeps being offered", () => {
  const base = {
    ownership: "household_native" as const,
    isRoutine: true,
    actorHasDeclinedHandoff: false,
    candidateCount: 1,
  };

  it("offers it while the member has never said the chore is settled", () => {
    expect(shouldOfferResponsibilityHandoff(base)).toBe(true);
  });

  it("stops for good once that member says it is settled", () => {
    // "Mom waters the plants" completes every week. Asking who has it next,
    // every week, forever, is an interruption the product manufactured.
    expect(shouldOfferResponsibilityHandoff({ ...base, actorHasDeclinedHandoff: true })).toBe(
      false,
    );
  });

  it("never asks where the question has no answer", () => {
    // A one-time Action has no next time, a member-owned record has no holder,
    // and a household of one has nobody to hand to.
    expect(shouldOfferResponsibilityHandoff({ ...base, isRoutine: false })).toBe(false);
    expect(shouldOfferResponsibilityHandoff({ ...base, ownership: "member_owned" })).toBe(false);
    expect(shouldOfferResponsibilityHandoff({ ...base, candidateCount: 0 })).toBe(false);
  });
});
