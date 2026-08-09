import { describe, expect, it } from "vitest";
import {
  evaluateHouseholdAuthorization,
  HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE,
  type HouseholdAuthorizationSubject,
  HouseholdRecordUnavailableError,
  proofCovers,
  proveHouseholdComposition,
  requireHouseholdAuthorization,
} from "./household-authorization";

const HOUSEHOLD = "household-1";
const OTHER_HOUSEHOLD = "household-2";
const OWNER = "owner-user";
const MEMBER = "member-user";
const OTHER_MEMBER = "other-member-user";
const DEPARTED = "departed-member-user";
const STRANGER = "stranger-user";

const activeMemberships = [
  { householdId: HOUSEHOLD, userId: OWNER },
  { householdId: HOUSEHOLD, userId: MEMBER },
  { householdId: HOUSEHOLD, userId: OTHER_MEMBER },
];

function membershipsFor(userId: string) {
  return activeMemberships.filter((membership) => membership.userId === userId);
}

function subject(overrides: Partial<HouseholdAuthorizationSubject> = {}) {
  return {
    kind: "general_action",
    id: "record-1",
    ownerUserId: OWNER,
    scope: "household",
    householdId: HOUSEHOLD,
    ...overrides,
  } satisfies HouseholdAuthorizationSubject;
}

describe("Household Authorization Proof", () => {
  it("proves a private record for its owner and for nobody else", () => {
    const record = subject({ ownerUserId: MEMBER, scope: "private", householdId: null });

    expect(
      evaluateHouseholdAuthorization({
        callerUserId: MEMBER,
        operation: "view",
        subject: record,
        callerActiveMemberships: membershipsFor(MEMBER),
      }),
    ).toMatchObject({ authorized: true, via: "owner" });

    // The Household Owner role is not read at all: it grants no access to a
    // member's private record.
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: OWNER,
        operation: "view",
        subject: record,
        callerActiveMemberships: membershipsFor(OWNER),
      }),
    ).toMatchObject({ authorized: false, denial: "not_owner" });
  });

  it("proves a whole-household record for every active member and denies a departed one", () => {
    const record = subject({ scope: "household" });

    expect(
      evaluateHouseholdAuthorization({
        callerUserId: OTHER_MEMBER,
        operation: "view",
        subject: record,
        callerActiveMemberships: membershipsFor(OTHER_MEMBER),
      }),
    ).toMatchObject({ authorized: true, via: "household_audience" });

    // A departed member holds no active membership, so the same record that was
    // readable a moment ago is now indistinguishable from one that never existed.
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: DEPARTED,
        operation: "view",
        subject: record,
        callerActiveMemberships: [],
      }),
    ).toMatchObject({ authorized: false, denial: "not_active_member" });
  });

  it("proves a selected-member record only for the owner and the explicitly selected members", () => {
    const record = subject({ scope: "shared", audienceUserIds: [MEMBER] });

    for (const [caller, expected] of [
      [OWNER, true],
      [MEMBER, true],
      [OTHER_MEMBER, false],
      [STRANGER, false],
    ] as const) {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: caller,
          operation: "view",
          subject: record,
          callerActiveMemberships: membershipsFor(caller),
        }).authorized,
      ).toBe(expected);
    }
  });

  it("never lets a membership in a different household authorize the record's household", () => {
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: STRANGER,
        operation: "view",
        subject: subject({ scope: "household" }),
        callerActiveMemberships: [{ householdId: OTHER_HOUSEHOLD, userId: STRANGER }],
      }),
    ).toMatchObject({ authorized: false, denial: "not_active_member" });
  });

  it("refuses an anonymous caller before it looks at the record", () => {
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: "",
        operation: "view",
        subject: subject({ scope: "household" }),
        callerActiveMemberships: [],
      }),
    ).toMatchObject({ authorized: false, denial: "no_caller" });
  });
});

describe("Household Authorization Proof operation authority", () => {
  it("keeps every mutation on a member-owned record with its owner, however wide the audience", () => {
    for (const scope of ["household", "shared"] as const) {
      const record = subject({
        scope,
        audienceUserIds: scope === "shared" ? [MEMBER] : undefined,
      });

      for (const operation of ["update", "change_audience", "archive"] as const) {
        expect(
          evaluateHouseholdAuthorization({
            callerUserId: OWNER,
            operation,
            subject: record,
            callerActiveMemberships: membershipsFor(OWNER),
          }).authorized,
        ).toBe(true);

        // The member can read it; that never became authority to change it.
        expect(
          evaluateHouseholdAuthorization({
            callerUserId: MEMBER,
            operation,
            subject: record,
            callerActiveMemberships: membershipsFor(MEMBER),
          }),
        ).toMatchObject({ authorized: false, denial: "not_record_authority" });
      }
    }
  });

  it("gives every active member symmetric authority over a household-native record", () => {
    const record = subject({ ownership: "household_native", scope: "household" });

    for (const caller of [OWNER, MEMBER, OTHER_MEMBER]) {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: caller,
          operation: "update",
          subject: record,
          callerActiveMemberships: membershipsFor(caller),
        }),
      ).toMatchObject({ authorized: true, via: "household_authority" });
    }

    // Symmetric authority stops at the household edge.
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: DEPARTED,
        operation: "update",
        subject: record,
        callerActiveMemberships: [],
      }).authorized,
    ).toBe(false);
  });

  it("denies every operation on an ended record, including to its owner", () => {
    const record = subject({ lifecycle: "ended" });

    for (const operation of ["view", "update", "change_audience", "archive"] as const) {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: OWNER,
          operation,
          subject: record,
          callerActiveMemberships: membershipsFor(OWNER),
        }),
      ).toMatchObject({ authorized: false, denial: "record_ended" });
    }
  });

  it("applies a domain exclusion ahead of every other form of standing", () => {
    // The Surprise Subject of a Gift Plan is an active member of the household
    // the plan is shared into, so only the exclusion keeps them out.
    const record = subject({ scope: "household", excludedUserIds: [MEMBER] });

    expect(
      evaluateHouseholdAuthorization({
        callerUserId: MEMBER,
        operation: "view",
        subject: record,
        callerActiveMemberships: membershipsFor(MEMBER),
      }),
    ).toMatchObject({ authorized: false, denial: "domain_exclusion" });
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: OTHER_MEMBER,
        operation: "view",
        subject: record,
        callerActiveMemberships: membershipsFor(OTHER_MEMBER),
      }).authorized,
    ).toBe(true);
  });

  it("keeps restricted content out of ambient use while a direct request still resolves", () => {
    const record = subject({ scope: "household", sensitivity: "restricted" });

    for (const caller of [OWNER, MEMBER]) {
      expect(
        evaluateHouseholdAuthorization({
          callerUserId: caller,
          operation: "view",
          subject: record,
          callerActiveMemberships: membershipsFor(caller),
          purpose: "ambient",
        }),
      ).toMatchObject({ authorized: false, denial: "restricted_requires_direct_request" });

      expect(
        evaluateHouseholdAuthorization({
          callerUserId: caller,
          operation: "view",
          subject: record,
          callerActiveMemberships: membershipsFor(caller),
          purpose: "direct",
        }).authorized,
      ).toBe(true);
    }

    // A `sensitive` record is not restricted, so ambient surfaces keep it.
    expect(
      evaluateHouseholdAuthorization({
        callerUserId: MEMBER,
        operation: "view",
        subject: subject({ scope: "household", sensitivity: "sensitive" }),
        callerActiveMemberships: membershipsFor(MEMBER),
        purpose: "ambient",
      }).authorized,
    ).toBe(true);
  });
});

describe("Household Authorization Proof opacity", () => {
  it("refuses every denial with one indistinguishable error", () => {
    const denials = [
      { callerUserId: "", subject: subject({}), memberships: [] },
      { callerUserId: OWNER, subject: subject({ lifecycle: "ended" }), memberships: [] },
      { callerUserId: MEMBER, subject: subject({ scope: "private" }), memberships: [] },
      { callerUserId: DEPARTED, subject: subject({ scope: "household" }), memberships: [] },
      {
        callerUserId: OTHER_MEMBER,
        subject: subject({ scope: "shared", audienceUserIds: [MEMBER] }),
        memberships: membershipsFor(OTHER_MEMBER),
      },
      {
        callerUserId: MEMBER,
        subject: subject({ scope: "household", excludedUserIds: [MEMBER] }),
        memberships: membershipsFor(MEMBER),
      },
    ];

    const messages = new Set<string>();
    for (const denial of denials) {
      let raised: unknown;
      try {
        requireHouseholdAuthorization({
          callerUserId: denial.callerUserId,
          operation: "view",
          subject: denial.subject,
          callerActiveMemberships: denial.memberships,
        });
      } catch (error) {
        raised = error;
      }
      expect(raised).toBeInstanceOf(HouseholdRecordUnavailableError);
      messages.add((raised as Error).message);
    }

    expect([...messages]).toEqual([HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE]);
    // Nothing about the record, the household, or which gate refused.
    expect(HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE).not.toMatch(/household|member|owner|private/i);
  });

  it("returns the grant unchanged when the caller is authorized", () => {
    expect(
      requireHouseholdAuthorization({
        callerUserId: MEMBER,
        operation: "view",
        subject: subject({ scope: "household" }),
        callerActiveMemberships: membershipsFor(MEMBER),
      }),
    ).toMatchObject({ authorized: true, subjectId: "record-1", via: "household_audience" });
  });
});

describe("Household Authorization Proof reuse and composition", () => {
  function grantFor(caller: string, operation: "view" | "update" = "view") {
    return requireHouseholdAuthorization({
      callerUserId: caller,
      operation,
      subject: subject({ scope: "household" }),
      callerActiveMemberships: membershipsFor(caller),
    });
  }

  it("covers only the exact caller, operation, and record it was proved for", () => {
    const grant = grantFor(MEMBER);
    const request = {
      callerUserId: MEMBER,
      operation: "view" as const,
      subjectKind: "general_action",
      subjectId: "record-1",
    };

    expect(proofCovers(grant, request)).toBe(true);
    expect(proofCovers(grant, { ...request, callerUserId: OTHER_MEMBER })).toBe(false);
    expect(proofCovers(grant, { ...request, operation: "update" })).toBe(false);
    expect(proofCovers(grant, { ...request, subjectId: "record-2" })).toBe(false);
    expect(proofCovers(grant, { ...request, subjectKind: "memory" })).toBe(false);
  });

  it("composes by dropping every unproven member rather than leaving a placeholder", () => {
    const composition = proveHouseholdComposition({
      callerUserId: MEMBER,
      operation: "view",
      subjects: [
        subject({ id: "visible-household", scope: "household" }),
        subject({ id: "someone-elses-private", scope: "private" }),
        subject({ id: "unselected-share", scope: "shared", audienceUserIds: [OTHER_MEMBER] }),
        subject({ id: "selected-share", scope: "shared", audienceUserIds: [MEMBER] }),
        subject({ id: "excluded", scope: "household", excludedUserIds: [MEMBER] }),
      ],
      callerActiveMemberships: membershipsFor(MEMBER),
    });

    expect(composition.map((proof) => proof.subjectId)).toEqual([
      "visible-household",
      "selected-share",
    ]);
  });
});
