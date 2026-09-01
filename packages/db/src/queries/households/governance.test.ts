import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOUSEHOLD_RECOVERY_WINDOW_DAYS,
  HOUSEHOLD_STANDING_ENDED,
  type HouseholdMembership,
  HouseholdValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdGovernanceLifecycle } from "./governance";
import { seedHouseholdWithMembers } from "./household-fixtures";
import { createInMemoryHouseholdInvitationStore } from "./in-memory-invitation-store";
import { createHouseholdInvitationLifecycle } from "./invitations";
import {
  createNoopHouseholdScheduledWorkStore,
  type HouseholdScheduledWorkStore,
} from "./scheduled-work";

const ANA = "user-ana";
const BEN = "user-ben";
const CAI = "user-cai";
const NOW = new Date("2026-08-08T12:00:00Z");

type Fixture = ReturnType<typeof createFixture>;

function createFixture(scheduledWork?: HouseholdScheduledWorkStore) {
  const store = createInMemoryHouseholdInvitationStore({
    identities: [
      { id: ANA, name: "Ana", email: "ana@example.com" },
      { id: BEN, name: "Ben", email: "ben@example.com" },
      { id: CAI, name: "Cai", email: "cai@example.com" },
    ],
    ...(scheduledWork ? { scheduledWork } : {}),
  });
  return {
    store,
    governance: createHouseholdGovernanceLifecycle(store, { now: () => NOW }),
    invitations: createHouseholdInvitationLifecycle(store, { now: () => NOW }),
  };
}

/** One household holding the named people, `ANA` owning it. */
async function seed(
  fixture: Fixture,
  members: ReadonlyArray<readonly [string, "owner" | "member"]>,
) {
  return seedHouseholdWithMembers(fixture.store.households, {
    ownerUserId: ANA,
    members,
  });
}

async function membershipFor(
  fixture: Fixture,
  householdId: string,
  userId: string,
): Promise<HouseholdMembership> {
  const membership = await fixture.store.households.getHouseholdMembership({ householdId, userId });
  if (!membership) throw new Error(`No membership for ${userId}`);
  return membership;
}

function auditActions(fixture: Fixture, actorUserId: string) {
  return fixture.store.households
    .listAuditLogEntries({ ownerUserId: actorUserId })
    .then((entries) => entries.map((entry) => entry.action));
}

async function auditEntry(
  fixture: Fixture,
  actorUserId: string,
  action: string,
): Promise<Record<string, unknown>> {
  const entries = await fixture.store.households.listAuditLogEntries({ ownerUserId: actorUserId });
  const entry = entries.find((row) => row.action === action);
  if (!entry) throw new Error(`No ${action} audit entry for ${actorUserId}`);
  return entry.metadataJson as Record<string, unknown>;
}

/** Which record families a departure asked to send home, in the order it asked. */
const sweptCalls = new WeakMap<object, Array<{ family: string; userId: string }>>();

/**
 * A scheduled-work store that records the sweep instead of performing it.
 *
 * Every family is one line here so that adding a family to the seam and
 * forgetting to call it from one of the three endings fails loudly rather than
 * quietly leaving those records in a household their owner has left.
 */
function recordingScheduledWork(): HouseholdScheduledWorkStore {
  const calls: Array<{ family: string; userId: string }> = [];
  const record = (family: string) => (userId: string) => {
    calls.push({ family, userId });
  };
  const store: HouseholdScheduledWorkStore = {
    ...createNoopHouseholdScheduledWorkStore(),
    revertMemberOwnedActionsToPrivate: async ({ ownerUserId }) => {
      record("actions")(ownerUserId);
      return [];
    },
    revertMemberOwnedAssetsToPrivate: async ({ ownerUserId }) => {
      record("assets")(ownerUserId);
      return [];
    },
    revertMemberOwnedSavedItemsToPrivate: async ({ ownerUserId }) => {
      record("saved-items")(ownerUserId);
      return [];
    },
    revertMemberOwnedRelationshipRecordsToPrivate: async ({ ownerUserId }) => {
      record("relationship-records")(ownerUserId);
      return { memories: [], sourceRecords: [], followups: [] };
    },
    clearResponsibilityHolderForMember: async ({ userId }) => {
      record("responsibilities")(userId);
      return [];
    },
  };
  sweptCalls.set(store, calls);
  return store;
}

function sweptFamilies(fixture: Fixture) {
  const scheduledWork = fixture.store.scheduledWork;
  return sweptCalls.get(scheduledWork) ?? [];
}

/** A sweep that moves a distinguishable number of rows in every family. */
function countingReverts(): Partial<HouseholdScheduledWorkStore> {
  return {
    revertMemberOwnedActionsToPrivate: async () => ["action"],
    revertMemberOwnedAssetsToPrivate: async () => ["asset"],
    revertMemberOwnedSavedItemsToPrivate: async () => ["saved-item"],
    revertMemberOwnedRelationshipRecordsToPrivate: async () => ({
      memories: ["memory"],
      sourceRecords: ["source-a", "source-b", "source-c"],
      followups: ["followup"],
    }),
    clearResponsibilityHolderForMember: async () => ["action"],
  };
}

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});

describe("promotion to co-owner", () => {
  it("offers rather than promotes, and the recipient's acceptance is what changes the role", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);

    await fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN });

    const offered = await membershipFor(fixture, household.id, BEN);
    // The offer changes nothing about authority. Ben is still a member.
    expect(offered).toMatchObject({
      role: "member",
      pendingRole: "owner",
      pendingRoleOfferedByUserId: ANA,
    });

    await fixture.governance.acceptOwnerRole({ userId: BEN });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({
      role: "owner",
      pendingRole: null,
      pendingRoleOfferedByUserId: null,
    });
    expect(await auditActions(fixture, BEN)).toContain("household.owner_offer_accept");
  });

  it("leaves the role untouched when the offer is declined", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN });

    await fixture.governance.declineOwnerRole({ userId: BEN });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({
      role: "member",
      pendingRole: null,
    });
    // Declining is not a door that closes: the offer can be made again.
    await expect(
      fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN }),
    ).resolves.toMatchObject({ pendingRole: "owner" });
  });

  it("refuses an acceptance nobody offered", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await expect(fixture.governance.acceptOwnerRole({ userId: BEN })).rejects.toThrow(
      HouseholdValidationError,
    );
  });

  it("is an owner-only offer", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
      [CAI, "member"],
    ]);
    await expect(
      fixture.governance.offerOwnerRole({ actorUserId: BEN, memberUserId: CAI }),
    ).rejects.toThrow("Household owner permissions required.");
  });

  it("lets an owner take an unanswered offer back", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN });

    await fixture.governance.withdrawOwnerOffer({ actorUserId: ANA, memberUserId: BEN });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ pendingRole: null });
    await expect(fixture.governance.acceptOwnerRole({ userId: BEN })).rejects.toThrow(
      HouseholdValidationError,
    );
  });
});

describe("protected owners", () => {
  it("never lets one owner remove another", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);

    await expect(
      fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN }),
    ).rejects.toThrow(/can't remove another owner/i);
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "active" });
  });

  it("offers no demotion at all — stepping down is the owner's own act", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);

    await fixture.governance.stepDownFromOwner({ userId: BEN });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({
      role: "member",
      status: "active",
    });
  });

  it("holds the last owner back from stepping down or leaving", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);

    await expect(fixture.governance.stepDownFromOwner({ userId: ANA })).rejects.toThrow(
      /only owner/i,
    );
    await expect(fixture.governance.leaveHousehold({ userId: ANA })).rejects.toThrow(/only owner/i);
  });

  it("lets the held owner leave once someone accepts co-ownership", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);

    await fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN });
    // Still held: an unanswered offer is not a second owner.
    await expect(fixture.governance.leaveHousehold({ userId: ANA })).rejects.toThrow(/only owner/i);

    await fixture.governance.acceptOwnerRole({ userId: BEN });
    await fixture.governance.leaveHousehold({ userId: ANA });

    expect(await membershipFor(fixture, household.id, ANA)).toMatchObject({ status: "removed" });
  });
});

describe("removal and departure", () => {
  /**
   * The revocation half of the acceptance criterion: access and member-owned
   * sharing stop at once, in both directions.
   */
  it("revokes both directions of member-owned sharing", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
      [CAI, "member"],
    ]);
    const share = (recordId: string, sharedByUserId: string, sharedWithUserId: string) =>
      fixture.store.households.createHouseholdRecordShare({
        householdId: household.id,
        recordKind: "memory",
        recordId,
        sharedByUserId,
        sharedWithUserId,
      });

    await share("record-ana", ANA, BEN);
    await share("record-ben", BEN, ANA);
    await share("record-cai", CAI, ANA);

    await fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN });

    const remaining = await fixture.store.households.listHouseholdRecordSharesForRecords({
      householdIds: [household.id],
      recordKind: "memory",
      recordIds: ["record-ana", "record-ben", "record-cai"],
    });
    // Only the share that involves neither of the two survives.
    expect(remaining.map((row) => row.recordId)).toEqual(["record-cai"]);
  });

  it("keeps the membership row, its role, and its dates as historical fact", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);

    await fixture.governance.leaveHousehold({ userId: BEN });

    const departed = await membershipFor(fixture, household.id, BEN);
    expect(departed).toMatchObject({ status: "removed", role: "owner", removedAt: NOW });
    expect(departed.acceptedAt).not.toBeNull();
  });

  it.each([
    ["removal", (f: Fixture) => f.governance.removeMember({ actorUserId: ANA, memberUserId: BEN })],
    ["voluntary departure", (f: Fixture) => f.governance.leaveHousehold({ userId: BEN })],
  ] as const)(
    "sends every family of the departing person's own records home on %s",
    async (_label, end) => {
      // The sweep is deliberately id-returning and store-shaped, so what this
      // asserts is that governance *asks* for each family. One household record
      // family silently missing from a departure is the failure mode worth
      // catching, and it has happened twice: Assets (#386) were the moment it
      // could, and Saved Items were the moment it did.
      const recording = createFixture(recordingScheduledWork());
      await seedHouseholdWithMembers(recording.store.households, {
        ownerUserId: ANA,
        members: [
          [ANA, "owner"],
          [BEN, "member"],
        ],
      });

      await end(recording);

      expect(sweptFamilies(recording)).toEqual([
        { family: "actions", userId: BEN },
        { family: "assets", userId: BEN },
        { family: "saved-items", userId: BEN },
        { family: "relationship-records", userId: BEN },
        { family: "responsibilities", userId: BEN },
      ]);
    },
  );

  it("sends every family home for every member when the household is dissolved", async () => {
    // Dissolution is every member departing at once, so it owes each of them the
    // same sweep an individual departure would have given them - including the
    // responsibility clear, which it used to skip, leaving the 30-day recovery
    // set naming people who had been removed (ADR 0215).
    const recording = createFixture(recordingScheduledWork());
    await seedHouseholdWithMembers(recording.store.households, {
      ownerUserId: ANA,
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });

    await recording.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    const families = [
      "actions",
      "assets",
      "saved-items",
      "relationship-records",
      "responsibilities",
    ];
    expect(sweptFamilies(recording)).toEqual([
      ...families.map((family) => ({ family, userId: ANA })),
      ...families.map((family) => ({ family, userId: BEN })),
    ]);
  });

  it("records the same set of counts however the household access ended", async () => {
    // Removal, departure, and dissolution differ in who decided and in nothing
    // else the trail is allowed to be vaguer about. Each of these keys went
    // missing from one payload or another before this test existed.
    const counted = { ...createNoopHouseholdScheduledWorkStore(), ...countingReverts() };
    const removal = createFixture(counted);
    await seedHouseholdWithMembers(removal.store.households, {
      ownerUserId: ANA,
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    await removal.governance.removeMember({ actorUserId: ANA, memberUserId: BEN });

    const departure = createFixture(counted);
    await seedHouseholdWithMembers(departure.store.households, {
      ownerUserId: ANA,
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    await departure.governance.leaveHousehold({ userId: BEN });

    const dissolution = createFixture(counted);
    await seedHouseholdWithMembers(dissolution.store.households, {
      ownerUserId: ANA,
      members: [[ANA, "owner"]],
    });
    await dissolution.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    const expected = [
      "canceledActionReminders",
      "canceledInvitations",
      "clearedResponsibilities",
      "disconnectedCalendars",
      "revertedActions",
      "revertedAssets",
      "revertedFollowups",
      "revertedMemories",
      "revertedSavedItems",
      "revertedSourceRecords",
    ];
    for (const [fixture, actor, action] of [
      [removal, ANA, "household.member_remove"],
      [departure, BEN, "household.member_leave"],
      [dissolution, ANA, "household.dissolve"],
    ] as const) {
      const entry = await auditEntry(fixture, actor, action);
      expect(
        Object.keys(entry)
          .filter((key) => expected.includes(key))
          .sort(),
      ).toEqual(expected);
      // Every count is the real one from the sweep, not a zero placeholder.
      expect(entry.revertedSavedItems).toBe(1);
      expect(entry.revertedSourceRecords).toBe(3);
    }
  });

  it("takes the departing person's outstanding invitations with them", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    const sent = await fixture.invitations.sendInvitation({
      ownerUserId: BEN,
      email: "dee@example.com",
    });
    const kept = await fixture.invitations.sendInvitation({
      ownerUserId: ANA,
      email: "eve@example.com",
    });

    await fixture.governance.leaveHousehold({ userId: BEN });

    const invitations = await fixture.invitations.listInvitationsForOwner({ ownerUserId: ANA });
    expect(invitations.find((row) => row.id === sent.invitation.id)?.state).toBe("canceled");
    expect(invitations.find((row) => row.id === kept.invitation.id)?.state).toBe("pending");
  });

  /** Re-entry is a fresh invitation, never a resurrection of the old row (ADR 0213). */
  it("lets a removed person back in only through a new invitation", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN });

    const invitation = await fixture.invitations.sendInvitation({
      ownerUserId: ANA,
      email: "ben@example.com",
    });
    await fixture.invitations.acceptInvitation({
      secret: invitation.secret,
      userId: BEN,
      userEmail: "ben@example.com",
    });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({
      status: "active",
      role: "member",
    });
  });

  it("refuses to remove someone who is already gone, and refuses self-removal", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN });

    await expect(
      fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN }),
    ).rejects.toThrow(/no longer in this household/i);
    await expect(
      fixture.governance.removeMember({ actorUserId: ANA, memberUserId: ANA }),
    ).rejects.toThrow(/leaving is yours to do/i);
  });

  /**
   * The last-owner rule is only a rule if the roster it reads is the roster at
   * the moment of the decision. Two co-owners leaving at once must not both see
   * the other still governing; the household's row lock is what orders them, and
   * this pins that the lock is taken before anything is read.
   */
  it("decides departure against a roster read under the household's lock", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    const order: string[] = [];
    const store = fixture.store;
    const lockHousehold = store.lockHousehold.bind(store);
    const listMemberships = store.households.listHouseholdMemberships.bind(store.households);
    store.lockHousehold = async (input) => {
      order.push("lock");
      return lockHousehold(input);
    };
    store.households.listHouseholdMemberships = async (input) => {
      order.push("roster");
      return listMemberships(input);
    };

    await fixture.governance.leaveHousehold({ userId: BEN });

    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("roster"));
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "removed" });
    // The rule closes behind Ben: Ana is now alone, and told the exit she has.
    await expect(fixture.governance.leaveHousehold({ userId: ANA })).rejects.toThrow(
      /only person here/i,
    );
  });

  it("drops an unanswered offer when the person it was made to leaves", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.offerOwnerRole({ actorUserId: ANA, memberUserId: BEN });

    await fixture.governance.leaveHousehold({ userId: BEN });

    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({
      status: "removed",
      pendingRole: null,
    });
  });
});

describe("dissolution", () => {
  it("ends a sole owner's household on their single confirmation", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.invitations.sendInvitation({ ownerUserId: ANA, email: "dee@example.com" });

    const state = await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    expect(state).toMatchObject({ required: 1, confirmed: 1, unanimous: true });
    expect(state.dissolved).toMatchObject({
      dissolvedAt: NOW,
      canceledInvitations: 1,
      endedMemberships: 2,
    });
    expect(state.dissolved?.recoveryDeadlineAt.getTime()).toBe(
      NOW.getTime() + HOUSEHOLD_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    // Everyone's access ends at once, and the workspace survives as a record of
    // the household that was.
    expect(await membershipFor(fixture, household.id, ANA)).toMatchObject({ status: "removed" });
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "removed" });
    expect(
      await fixture.store.households.getHouseholdWorkspace({ householdId: household.id }),
    ).toMatchObject({ status: "dissolved", dissolvedAt: NOW });
  });

  it("waits for every active owner before anything ends", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);

    const first = await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: false });
    expect(first).toMatchObject({ required: 2, confirmed: 1, unanimous: false, dissolved: null });
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "active" });

    const second = await fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: true });
    expect(second.unanimous).toBe(true);
    expect(second.dissolved).not.toBeNull();
  });

  /**
   * The retyped phrase in front of the final press is what keeps a household
   * from ending on a reflex, and `endsNow` is read off an Overview that can be a
   * moment old. An owner still being offered an ordinary agreement - the one
   * whose copy promises nothing changes yet - must not end the household for
   * everyone because somebody else agreed while they were reading it.
   */
  it("declines a press offered as an agreement once it would be the last one", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: false });

    const state = await fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: false });

    // Nothing was written. Ben has still not agreed, so the household stands and
    // the question returns to him as the final one it has become.
    expect(state).toMatchObject({ required: 2, confirmed: 1, unanimous: false, dissolved: null });
    expect(state.awaitingUserIds).toEqual([BEN]);
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "active" });
    expect(
      await fixture.store.households.getHouseholdWorkspace({ householdId: household.id }),
    ).toMatchObject({ status: "active" });

    // The same press, made knowingly, is the one that ends it.
    const ended = await fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: true });
    expect(ended.dissolved).not.toBeNull();
  });

  it("lets any owner call the whole thing off", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: false });

    const state = await fixture.governance.cancelDissolution({ ownerUserId: BEN });

    expect(state).toMatchObject({ confirmed: 0, unanimous: false, dissolved: null });
    expect(
      await fixture.store.households.getHouseholdWorkspace({ householdId: household.id }),
    ).toMatchObject({ status: "active" });
  });

  it("does not count a confirmation from someone who has stopped being an owner", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: false });
    await fixture.governance.stepDownFromOwner({ userId: BEN });

    const state = await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    expect(state).toMatchObject({ required: 1, confirmed: 1, unanimous: true });
    // Ana is now the only owner, so her own confirmation is unanimity — but Ben's
    // withdrawn one is what must not have counted, so the required set is 1.
    expect(state.awaitingUserIds).toEqual([]);
    expect(
      await fixture.store.households.getHouseholdWorkspace({ householdId: household.id }),
    ).toMatchObject({ status: "dissolved" });
  });

  it("is refused to a member", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await expect(
      fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: true }),
    ).rejects.toThrow("Household owner permissions required.");
  });

  /**
   * The recovery boundary. There is no entry point here that restores a
   * dissolved household, and its former members have no standing to act on it —
   * which is exactly what "no self-service recovery bypass" has to mean.
   */
  it("leaves no way back in from inside the product", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "member"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    expect(Object.keys(fixture.governance)).not.toContain("restoreHousehold");
    for (const userId of [ANA, BEN]) {
      await expect(
        fixture.governance.confirmDissolution({ ownerUserId: userId, endsNow: true }),
      ).rejects.toThrow(HOUSEHOLD_STANDING_ENDED);
      await expect(fixture.governance.leaveHousehold({ userId })).rejects.toThrow(
        HOUSEHOLD_STANDING_ENDED,
      );
    }
  });

  /**
   * The refusal a stale screen gets has to be curated, not an infrastructure
   * failure. Only curated failures reach the reader as their own sentence; a
   * bare `Error` reaches them as "nothing changed, try again", which is the one
   * instruction that cannot help someone whose household has already ended.
   */
  it("refuses a former member in words the surface may show them", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    await expect(fixture.governance.leaveHousehold({ userId: ANA })).rejects.toBeInstanceOf(
      HouseholdValidationError,
    );
  });

  it("frees its creator to start a household again", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    await expect(
      fixture.store.households.createHouseholdWorkspace({
        ownerUserId: ANA,
        name: "A fresh start",
        defaultScope: "private",
      }),
    ).resolves.toMatchObject({ name: "A fresh start", status: "active" });
  });

  it("records who agreed and when the recovery window closes", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA, endsNow: false });
    await fixture.governance.confirmDissolution({ ownerUserId: BEN, endsNow: true });

    const [entry] = (
      await fixture.store.households.listAuditLogEntries({ ownerUserId: BEN })
    ).filter((row) => row.action === "household.dissolve");
    expect(entry?.metadataJson).toMatchObject({
      recovery: "support-only",
      confirmedOwnerUserIds: [ANA, BEN],
    });
  });
});

/**
 * The unguarded removal that must stay unreachable.
 *
 * `createHouseholdLifecycle` still carries a `removeMember` from before this
 * slice. It ends a membership without ever consulting the protected-co-owner
 * rule, so a caller that reached for it would have a way to remove an Owner —
 * the one thing ADR 0213 says nobody may do to anybody. The governed path is the
 * only one wired up, and this pins that: the repo has no live Drizzle harness,
 * so the production half of the wiring is asserted against source (#315), while
 * the behavior it protects is exercised against the in-memory adapter above.
 */
describe("governed removal is the only removal", () => {
  const queriesDir = join(import.meta.dirname, "..");

  it("routes the exported entry point through the governance lifecycle", () => {
    const source = readFileSync(join(queriesDir, "households.ts"), "utf8");
    expect(source).toContain("defaultHouseholdGovernance.removeMember(input)");
    expect(source).not.toContain("defaultHouseholdLifecycle.removeMember");
  });

  it("has no production caller reaching past it", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(queriesDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      // The lifecycle's own definition is the thing being fenced off, not a call.
      if (entry.name === "lifecycle.ts") continue;
      const path = join(entry.parentPath, entry.name);
      if (/\.removeMember\(/.test(readFileSync(path, "utf8"))) {
        offenders.push(path.slice(queriesDir.length + 1));
      }
    }
    expect(offenders).toEqual(["households.ts"]);
  });
});

/**
 * What happens after the transaction has committed, and what must not.
 *
 * The hooks are derived cleanup running on an ending that is already true and
 * irreversible. One of them failing used to throw out of a completed departure
 * *and* skip every hook queued behind it, so a Gift Plan outage took Saved Item
 * reminder revocation down with it - the reverse of what either family wanted.
 */
describe("post-commit hooks", () => {
  function fixtureWithHooks(hooks: {
    onHouseholdAccessEnded?: (input: { householdId: string; userId?: string }) => Promise<void>;
    onAccessEnded?: (input: { householdId: string; userId: string }) => Promise<void>;
  }) {
    const store = createInMemoryHouseholdInvitationStore({
      identities: [
        { id: ANA, name: "Ana", email: "ana@example.com" },
        { id: BEN, name: "Ben", email: "ben@example.com" },
      ],
    });
    return {
      store,
      governance: createHouseholdGovernanceLifecycle(store, { now: () => NOW, ...hooks }),
    };
  }

  it.each([
    ["the whole-household hook", "onHouseholdAccessEnded"],
    ["the per-member hook", "onAccessEnded"],
  ] as const)(
    "finishes the departure and the other hook when %s throws",
    async (_label, failing) => {
      const ran: string[] = [];
      const harness = fixtureWithHooks({
        onHouseholdAccessEnded: async () => {
          if (failing === "onHouseholdAccessEnded") throw new Error("gift plan sweep is down");
          ran.push("household");
        },
        onAccessEnded: async () => {
          if (failing === "onAccessEnded") throw new Error("reminder revocation is down");
          ran.push("member");
        },
      });
      await seedHouseholdWithMembers(harness.store.households, {
        ownerUserId: ANA,
        members: [
          [ANA, "owner"],
          [BEN, "member"],
        ],
      });

      // The departure itself resolves - the rows have moved, and reporting an
      // error would invite a retry of something that cannot be done twice.
      await expect(harness.governance.leaveHousehold({ userId: BEN })).resolves.toMatchObject({
        status: "removed",
      });
      // And the hook that did not fail still ran.
      expect(ran).toEqual([failing === "onHouseholdAccessEnded" ? "member" : "household"]);
    },
  );

  it("tells the whole-household hook that a dissolution was not a departure", async () => {
    const calls: Array<{ userId?: string }> = [];
    const members: string[] = [];
    const harness = fixtureWithHooks({
      onHouseholdAccessEnded: async ({ userId }) => {
        calls.push({ userId });
      },
      onAccessEnded: async ({ userId }) => {
        members.push(userId);
      },
    });
    await seedHouseholdWithMembers(harness.store.households, {
      ownerUserId: ANA,
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });

    await harness.governance.confirmDissolution({ ownerUserId: ANA, endsNow: true });

    // No `userId`: nobody in particular left, the household ended.
    expect(calls).toEqual([{ userId: undefined }]);
    // Every member who was still active hears about it individually.
    expect(members.sort()).toEqual([ANA, BEN]);
  });
});
