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

  it("sends every family of the departing person's own records home, in the same breath", async () => {
    // The sweep is deliberately id-returning and store-shaped, so what this
    // asserts is that governance *asks* for each family. One household record
    // family silently missing from a departure is the failure mode worth
    // catching, and adding Assets (#386) is exactly the moment it could happen.
    const reverted: Array<{ family: string; ownerUserId: string }> = [];
    const recording = createFixture({
      ...createNoopHouseholdScheduledWorkStore(),
      revertMemberOwnedActionsToPrivate: async ({ ownerUserId }) => {
        reverted.push({ family: "actions", ownerUserId });
        return [];
      },
      revertMemberOwnedAssetsToPrivate: async ({ ownerUserId }) => {
        reverted.push({ family: "assets", ownerUserId });
        return [];
      },
    });
    await seedHouseholdWithMembers(recording.store.households, {
      ownerUserId: ANA,
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });

    await recording.governance.leaveHousehold({ userId: BEN });

    expect(reverted).toEqual([
      { family: "actions", ownerUserId: BEN },
      { family: "assets", ownerUserId: BEN },
    ]);
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

    const state = await fixture.governance.confirmDissolution({ ownerUserId: ANA });

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

    const first = await fixture.governance.confirmDissolution({ ownerUserId: ANA });
    expect(first).toMatchObject({ required: 2, confirmed: 1, unanimous: false, dissolved: null });
    expect(await membershipFor(fixture, household.id, BEN)).toMatchObject({ status: "active" });

    const second = await fixture.governance.confirmDissolution({ ownerUserId: BEN });
    expect(second.unanimous).toBe(true);
    expect(second.dissolved).not.toBeNull();
  });

  it("lets any owner call the whole thing off", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA });

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
    await fixture.governance.confirmDissolution({ ownerUserId: BEN });
    await fixture.governance.stepDownFromOwner({ userId: BEN });

    const state = await fixture.governance.confirmDissolution({ ownerUserId: ANA });

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
    await expect(fixture.governance.confirmDissolution({ ownerUserId: BEN })).rejects.toThrow(
      "Household owner permissions required.",
    );
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
    await fixture.governance.confirmDissolution({ ownerUserId: ANA });

    expect(Object.keys(fixture.governance)).not.toContain("restoreHousehold");
    for (const userId of [ANA, BEN]) {
      await expect(fixture.governance.confirmDissolution({ ownerUserId: userId })).rejects.toThrow(
        HOUSEHOLD_STANDING_ENDED,
      );
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
    await fixture.governance.confirmDissolution({ ownerUserId: ANA });

    await expect(fixture.governance.leaveHousehold({ userId: ANA })).rejects.toBeInstanceOf(
      HouseholdValidationError,
    );
  });

  it("frees its creator to start a household again", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    await fixture.governance.confirmDissolution({ ownerUserId: ANA });

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
    await fixture.governance.confirmDissolution({ ownerUserId: ANA });
    await fixture.governance.confirmDissolution({ ownerUserId: BEN });

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
