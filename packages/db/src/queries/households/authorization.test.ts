import type { HouseholdOperation } from "@tendnote/domain";
import { HouseholdRecordUnavailableError, proofCovers } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdAuthorizationProver, type HouseholdRecordFacts } from "./authorization";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdLifecycle } from "./lifecycle";

/**
 * The household deliberately has a Household Owner who owns none of the records
 * under test, so every expectation below distinguishes record ownership from the
 * governance role. `RECORD_OWNER` is a plain member.
 */
const HOUSE_OWNER = "house-owner-user";
const RECORD_OWNER = "record-owner-user";
const AUDIENCE_MEMBER = "audience-member-user";
const OTHER_MEMBER = "other-member-user";
const DEPARTED = "departed-member-user";
const STRANGER = "stranger-user";

const MEMBERS = [RECORD_OWNER, AUDIENCE_MEMBER, OTHER_MEMBER, DEPARTED] as const;

const PRIVATE_RECORD = "00000000-0000-4000-8000-000000000001";
const HOUSEHOLD_RECORD = "00000000-0000-4000-8000-000000000002";
const SHARED_RECORD = "00000000-0000-4000-8000-000000000003";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * One household, four members, three records at the three scopes, and one member
 * who was active and is not any more. `DEPARTED` stays in the shared record's
 * audience on purpose: the share row outlives the membership, so the suite can
 * prove that a live share row is not standing.
 */
async function createFixture() {
  const store = createInMemoryHouseholdStore();
  const lifecycle = createHouseholdLifecycle(store);
  const { household } = await lifecycle.createHousehold({
    ownerUserId: HOUSE_OWNER,
    name: "Home",
  });

  for (const userId of MEMBERS) {
    await lifecycle.inviteMember({
      ownerUserId: HOUSE_OWNER,
      householdId: household.id,
      invitedUserId: userId,
    });
    await lifecycle.acceptInvite({ userId, householdId: household.id });
  }

  await lifecycle.shareRecordWithSelectedMembers({
    actorUserId: RECORD_OWNER,
    householdId: household.id,
    recordKind: "general_action",
    recordId: SHARED_RECORD,
    selectedUserIds: [AUDIENCE_MEMBER, DEPARTED],
  });

  await lifecycle.removeMember({
    ownerUserId: HOUSE_OWNER,
    householdId: household.id,
    memberUserId: DEPARTED,
  });

  const records = {
    private: {
      kind: "general_action",
      id: PRIVATE_RECORD,
      ownerUserId: RECORD_OWNER,
      scope: "private",
      householdId: null,
    },
    household: {
      kind: "general_action",
      id: HOUSEHOLD_RECORD,
      ownerUserId: RECORD_OWNER,
      scope: "household",
      householdId: household.id,
    },
    shared: {
      kind: "general_action",
      id: SHARED_RECORD,
      ownerUserId: RECORD_OWNER,
      scope: "shared",
      householdId: household.id,
    },
  } satisfies Record<string, HouseholdRecordFacts>;

  return {
    store,
    lifecycle,
    householdId: household.id,
    records,
    prover: createHouseholdAuthorizationProver(store),
  };
}

const CALLERS = [
  { id: RECORD_OWNER, label: "the record's own member owner" },
  { id: HOUSE_OWNER, label: "the Household Owner, who owns no record here" },
  { id: AUDIENCE_MEMBER, label: "the selected member" },
  { id: OTHER_MEMBER, label: "an active member outside the selection" },
  { id: DEPARTED, label: "a departed member still named by a share row" },
  { id: STRANGER, label: "a user who was never a member" },
] as const;

type Verdict = { view: boolean; write: boolean };

const ALLOWED: Verdict = { view: true, write: true };
const READ_ONLY: Verdict = { view: true, write: false };
const DENIED: Verdict = { view: false, write: false };

/**
 * The whole policy, written out rather than derived: every caller against every
 * scope, so a rule that quietly stops applying to one of them fails here instead
 * of disappearing into an untested corner.
 *
 * `write` covers `update`, `change_audience`, and `archive` together. A
 * member-owned record keeps all three with its owner, so there is no operation
 * among them a reader picks up by being in the audience — which is the invariant
 * this column exists to hold.
 */
const POLICY: Record<keyof Fixture["records"], Record<string, Verdict>> = {
  // A private record is its owner's alone. The governance role adds nothing.
  private: {
    [RECORD_OWNER]: ALLOWED,
    [HOUSE_OWNER]: DENIED,
    [AUDIENCE_MEMBER]: DENIED,
    [OTHER_MEMBER]: DENIED,
    [DEPARTED]: DENIED,
    [STRANGER]: DENIED,
  },
  // Every active member reads it; only its owner changes it.
  household: {
    [RECORD_OWNER]: ALLOWED,
    [HOUSE_OWNER]: READ_ONLY,
    [AUDIENCE_MEMBER]: READ_ONLY,
    [OTHER_MEMBER]: READ_ONLY,
    [DEPARTED]: DENIED,
    [STRANGER]: DENIED,
  },
  // Narrowed to the audience the owner chose, which the Household Owner is not
  // in and which a departed member's surviving share row does not put them back in.
  shared: {
    [RECORD_OWNER]: ALLOWED,
    [HOUSE_OWNER]: DENIED,
    [AUDIENCE_MEMBER]: READ_ONLY,
    [OTHER_MEMBER]: DENIED,
    [DEPARTED]: DENIED,
    [STRANGER]: DENIED,
  },
};

const SCOPES = ["private", "household", "shared"] as const;

const POLICY_CASES = SCOPES.flatMap((scope) =>
  CALLERS.map((caller) => ({
    scope,
    caller: caller.id,
    callerLabel: caller.label,
    ...(POLICY[scope][caller.id] ?? DENIED),
  })),
);

const WRITE_OPERATIONS = ["update", "change_audience", "archive"] as const satisfies readonly [
  HouseholdOperation,
  ...HouseholdOperation[],
];

describe("Household Authorization Proof policy matrix", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  it.each(POLICY_CASES)(
    "$scope scope, $callerLabel: view=$view write=$write",
    async ({ scope, caller, view, write }) => {
      const record = fixture.records[scope];

      expect(
        (
          await fixture.prover.proveRecordAccess({
            callerUserId: caller,
            operation: "view",
            record,
          })
        ).authorized,
      ).toBe(view);

      for (const operation of WRITE_OPERATIONS) {
        expect(
          (await fixture.prover.proveRecordAccess({ callerUserId: caller, operation, record }))
            .authorized,
        ).toBe(write);
      }
    },
  );

  it("composes a mixed list from the same matrix, leaving nothing behind for the rest", async () => {
    const all = [fixture.records.private, fixture.records.household, fixture.records.shared];

    for (const caller of CALLERS) {
      const grants = await fixture.prover.proveVisibleRecords({
        callerUserId: caller.id,
        operation: "view",
        records: all,
      });
      const expected = SCOPES.filter((scope) => POLICY[scope][caller.id]?.view).map(
        (scope) => fixture.records[scope].id,
      );

      // Derived surfaces get the proven records and no trace of the others — not
      // a placeholder, not a count, not a shortened list they could measure.
      expect(grants.map((grant) => grant.subjectId)).toEqual(expected);
      expect(grants).toHaveLength(expected.length);
    }
  });

  it("makes a held grant useless the moment the membership behind it ends", async () => {
    const record = fixture.records.household;
    const grant = await fixture.prover.requireRecordAccess({
      callerUserId: OTHER_MEMBER,
      operation: "view",
      record,
    });

    await fixture.lifecycle.removeMember({
      ownerUserId: HOUSE_OWNER,
      householdId: fixture.householdId,
      memberUserId: OTHER_MEMBER,
    });

    // The cached grant still matches the question by shape, which is exactly why
    // matching is not authorization: the holder must prove again, and now fails.
    expect(
      proofCovers(grant, {
        callerUserId: OTHER_MEMBER,
        operation: "view",
        subjectKind: "general_action",
        subjectId: record.id,
      }),
    ).toBe(true);
    await expect(
      fixture.prover.requireRecordAccess({ callerUserId: OTHER_MEMBER, operation: "view", record }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });

  it("revokes on the next proof when the owner narrows the audience", async () => {
    const record = fixture.records.shared;
    expect(
      (
        await fixture.prover.proveRecordAccess({
          callerUserId: AUDIENCE_MEMBER,
          operation: "view",
          record,
        })
      ).authorized,
    ).toBe(true);

    await fixture.store.deleteHouseholdRecordShares({
      householdId: fixture.householdId,
      recordKind: "general_action",
      recordId: record.id,
    });
    await fixture.lifecycle.shareRecordWithSelectedMembers({
      actorUserId: RECORD_OWNER,
      householdId: fixture.householdId,
      recordKind: "general_action",
      recordId: record.id,
      selectedUserIds: [OTHER_MEMBER],
    });

    expect(
      (
        await fixture.prover.proveRecordAccess({
          callerUserId: AUDIENCE_MEMBER,
          operation: "view",
          record,
        })
      ).authorized,
    ).toBe(false);
    expect(
      (
        await fixture.prover.proveRecordAccess({
          callerUserId: OTHER_MEMBER,
          operation: "view",
          record,
        })
      ).authorized,
    ).toBe(true);
  });
});

describe("Household Authorization Proof and derived read models", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  it("refills a viewer-scoped read model from a fresh proof, not from what it stored", async () => {
    // A cache shaped the way the real ones are: keyed by viewer, holding the ids a
    // proof once authorized. The stale entry is the hazard; the refill is the fix.
    const cache = new Map<string, string[]>();
    const records = [fixture.records.household, fixture.records.shared];

    async function refill(viewerUserId: string) {
      const grants = await fixture.prover.proveVisibleRecords({
        callerUserId: viewerUserId,
        operation: "view",
        records,
      });
      const ids = grants.map((grant) => grant.subjectId);
      cache.set(viewerUserId, ids);
      return ids;
    }

    expect(await refill(AUDIENCE_MEMBER)).toEqual([
      fixture.records.household.id,
      fixture.records.shared.id,
    ]);

    await fixture.lifecycle.removeMember({
      ownerUserId: HOUSE_OWNER,
      householdId: fixture.householdId,
      memberUserId: AUDIENCE_MEMBER,
    });

    // Invalidation has not run yet, so the stored model is still wrong — which is
    // exactly why the refill re-proves rather than trusting its own contents.
    expect(cache.get(AUDIENCE_MEMBER)).toContain(fixture.records.household.id);
    expect(await refill(AUDIENCE_MEMBER)).toEqual([]);
  });
});

describe("Household Authorization Proof fact sourcing", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  it("reads the selected audience from the share registry, never from the request", async () => {
    // The extra key is not part of a record's facts, so a route, tool, or queued
    // job cannot widen the audience of the record it is asking about.
    expect(
      (
        await fixture.prover.proveRecordAccess({
          callerUserId: OTHER_MEMBER,
          operation: "view",
          record: {
            ...fixture.records.shared,
            audienceUserIds: [OTHER_MEMBER],
          } as HouseholdRecordFacts,
        })
      ).authorized,
    ).toBe(false);
  });

  it("proves a private record without reading memberships at all", async () => {
    // The proof now runs on every single-record read, so the common case — a
    // caller opening their own private record — must not cost a second query.
    let membershipReads = 0;
    const counting = createHouseholdAuthorizationProver({
      listActiveHouseholdMembershipsForUser: (input) => {
        membershipReads += 1;
        return fixture.store.listActiveHouseholdMembershipsForUser(input);
      },
      listHouseholdRecordSharesForRecords: (input) =>
        fixture.store.listHouseholdRecordSharesForRecords(input),
    });

    expect(
      (
        await counting.proveRecordAccess({
          callerUserId: RECORD_OWNER,
          operation: "view",
          record: fixture.records.private,
        })
      ).authorized,
    ).toBe(true);
    expect(membershipReads).toBe(0);

    // A household-scoped record does need them, and reads them every time.
    await counting.proveRecordAccess({
      callerUserId: RECORD_OWNER,
      operation: "view",
      record: fixture.records.household,
    });
    expect(membershipReads).toBe(1);
  });

  it("carries the domain's own lifecycle, sensitivity, and exclusion facts into the decision", async () => {
    const record = fixture.records.household;

    expect(
      await fixture.prover.proveRecordAccess({
        callerUserId: RECORD_OWNER,
        operation: "view",
        record: { ...record, lifecycle: "ended" },
      }),
    ).toMatchObject({ authorized: false, denial: "record_ended" });

    expect(
      await fixture.prover.proveRecordAccess({
        callerUserId: OTHER_MEMBER,
        operation: "view",
        record: { ...record, sensitivity: "restricted" },
        purpose: "ambient",
      }),
    ).toMatchObject({ authorized: false, denial: "restricted_requires_direct_request" });

    expect(
      await fixture.prover.proveRecordAccess({
        callerUserId: OTHER_MEMBER,
        operation: "view",
        record: { ...record, excludedUserIds: [OTHER_MEMBER] },
      }),
    ).toMatchObject({ authorized: false, denial: "domain_exclusion" });
  });
});
