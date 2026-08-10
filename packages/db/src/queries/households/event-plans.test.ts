import { randomUUID } from "node:crypto";
import {
  HOUSEHOLD_EVENT_PLAN_LINK_LIMIT,
  HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE,
  type HouseholdEventPlan,
  HouseholdEventPlanConflictError,
  HouseholdRecordUnavailableError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdAuthorizationProver } from "./authorization";
import { createHouseholdEventPlanLifecycle } from "./event-plans";
import { removeHouseholdMember, seedHouseholdWithMembers } from "./household-fixtures";
import {
  createInMemoryHouseholdEventPlanLinkTargetStore,
  createInMemoryHouseholdEventPlanStore,
} from "./in-memory-event-plan-store";
import { createInMemoryHouseholdInvitationStore } from "./in-memory-invitation-store";

/**
 * `ANA` governs the household and `BEN` and `CAI` are plain members. Every
 * authority expectation below is written against that split on purpose: a Plan is
 * household-native, so the Owner role must never be what makes a write succeed,
 * and the creator must never be what makes another member's write fail.
 */
const ANA = "user-ana";
const BEN = "user-ben";
const CAI = "user-cai";
const DEE = "user-dee";

const NOW = new Date("2026-08-08T12:00:00Z");
const CONNECTION = "connection-family";
const CALENDAR = "family@group.calendar.google.com";

type Fixture = ReturnType<typeof createFixture>;

function createFixture() {
  const eventPlanStore = createInMemoryHouseholdEventPlanStore();
  const store = createInMemoryHouseholdInvitationStore();
  const linkTargets = createInMemoryHouseholdEventPlanLinkTargetStore();
  const prover = createHouseholdAuthorizationProver(store.households);

  return {
    store,
    linkTargets,
    prover,
    eventPlanStore,
    plans: createHouseholdEventPlanLifecycle({
      households: store.households,
      plans: eventPlanStore,
      linkTargets,
      prover,
      now: () => NOW,
    }),
  };
}

/** One household holding the named people, `ANA` owning it. */
async function seed(
  fixture: Fixture,
  members: ReadonlyArray<readonly [string, "owner" | "member"]> = [
    [ANA, "owner"],
    [BEN, "member"],
    [CAI, "member"],
  ],
) {
  return seedHouseholdWithMembers(fixture.store.households, { ownerUserId: ANA, members });
}

function createPlan(fixture: Fixture, callerUserId: string, title = "Saturday school fair") {
  return fixture.plans.createHouseholdEventPlan({ callerUserId, draft: { title } });
}

function storedPlan(fixture: Fixture, planId: string): HouseholdEventPlan {
  const plan = fixture.eventPlanStore.allPlans().find((candidate) => candidate.id === planId);
  if (!plan) throw new Error(`No stored plan ${planId}`);
  return plan;
}

/** Describes a link target the Authorization Proof can decide on its own facts. */
function seedTarget(
  fixture: Fixture,
  input: {
    recordId: string;
    ownerUserId: string;
    scope: "private" | "household" | "shared";
    householdId: string | null;
    title?: string;
  },
) {
  fixture.linkTargets.seed({
    linkKind: "general_action",
    recordId: input.recordId,
    facts: {
      ownerUserId: input.ownerUserId,
      scope: input.scope,
      householdId: input.householdId,
      title: input.title ?? `Action ${input.recordId}`,
    },
  });
}

async function linkIdsFor(fixture: Fixture, callerUserId: string, planId: string) {
  const { links } = await fixture.plans.getHouseholdEventPlan({ callerUserId, planId });
  return links.map((link) => link.recordId);
}

async function linkTitlesFor(fixture: Fixture, callerUserId: string, planId: string) {
  const { links } = await fixture.plans.getHouseholdEventPlan({ callerUserId, planId });
  return links.map((link) => link.title);
}

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});

describe("symmetric member authority", () => {
  it("lets any active member create, and any other member edit what they wrote", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, BEN);

    expect(plan).toMatchObject({
      title: "Saturday school fair",
      status: "active",
      createdByUserId: BEN,
      lastActorUserId: BEN,
      version: 1,
    });

    // CAI neither created it nor governs the household, and edits it anyway.
    const edited = await fixture.plans.updateHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
      expectedVersion: plan.version,
      draft: { title: "Saturday school fair", details: "Bring the folding chairs." },
    });

    expect(edited).toMatchObject({
      details: "Bring the folding chairs.",
      // Provenance, not authority: the creator is history and the last actor is
      // whoever wrote last.
      createdByUserId: BEN,
      lastActorUserId: CAI,
      version: 2,
    });
  });

  it("lets a plain member archive and restore a plan the household owner created", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);

    const archived = await fixture.plans.archiveHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
      expectedVersion: plan.version,
    });
    expect(archived).toMatchObject({ status: "archived", archivedAt: NOW, lastActorUserId: CAI });

    const restored = await fixture.plans.restoreHouseholdEventPlan({
      callerUserId: BEN,
      planId: plan.id,
      expectedVersion: archived.version,
    });
    expect(restored).toMatchObject({ status: "active", archivedAt: null, lastActorUserId: BEN });
  });

  it("gives a non-member and a removed member one opaque refusal for every operation", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    await removeHouseholdMember(fixture.store.households, {
      householdId: household.id,
      userId: CAI,
    });

    for (const callerUserId of [CAI, DEE]) {
      const attempts = [
        fixture.plans.getHouseholdEventPlan({ callerUserId, planId: plan.id }),
        fixture.plans.updateHouseholdEventPlan({
          callerUserId,
          planId: plan.id,
          expectedVersion: plan.version,
          draft: { title: "Mine now" },
        }),
        fixture.plans.archiveHouseholdEventPlan({
          callerUserId,
          planId: plan.id,
          expectedVersion: plan.version,
        }),
        fixture.plans.listHouseholdEventPlans({ callerUserId }),
        fixture.plans.createHouseholdEventPlan({ callerUserId, draft: { title: "Mine" } }),
      ];
      for (const attempt of attempts) {
        // The same sentence for "you were removed", "you were never here", and
        // "no such plan": the difference is the protected fact (ADR 0219).
        await expect(attempt).rejects.toThrow(HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE);
      }
    }
    // And none of it moved the record.
    expect(storedPlan(fixture, plan.id)).toMatchObject({
      title: "Saturday school fair",
      version: 1,
    });
  });

  it("refuses a plan that does not exist the same way it refuses one you may not see", async () => {
    await seed(fixture);
    await expect(
      fixture.plans.getHouseholdEventPlan({ callerUserId: ANA, planId: randomUUID() }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });
});

describe("listing plans", () => {
  /**
   * Every household-native Plan is visible to every active member by design, so
   * there is no membership arrangement that makes one of them unprovable. The
   * refusal is therefore injected at the proof seam - the same place a future
   * sensitivity, exclusion, or lifecycle fact would refuse from - and what is
   * asserted is the composition's own behavior: the record leaves nothing behind.
   */
  it("drops a plan the proof refuses, leaving no placeholder and no measurable gap", async () => {
    await seed(fixture);
    const visible = await createPlan(fixture, ANA, "School fair");
    const hidden = await createPlan(fixture, BEN, "Something else");

    const plans = createHouseholdEventPlanLifecycle({
      households: fixture.store.households,
      plans: fixture.eventPlanStore,
      linkTargets: fixture.linkTargets,
      prover: {
        ...fixture.prover,
        proveVisibleRecords: async (input) =>
          (await fixture.prover.proveVisibleRecords(input)).filter(
            (grant) => grant.subjectId !== hidden.id,
          ),
      },
      now: () => NOW,
    });

    const listed = await plans.listHouseholdEventPlans({ callerUserId: CAI });

    expect(listed.map((entry) => entry.plan.title)).toEqual(["School fair"]);
    expect(listed).toHaveLength(1);
    // Both rows are in the store; only one is in the answer, and the answer says
    // nothing about the other's existence.
    expect(fixture.eventPlanStore.allPlans()).toHaveLength(2);
    expect(listed.map((entry) => entry.plan.id)).not.toContain(hidden.id);
    expect(await plans.listHouseholdEventPlans({ callerUserId: ANA })).toMatchObject([
      { plan: { id: visible.id } },
    ]);
  });

  it("narrows to a lifecycle state when asked, and shows every member the same list", async () => {
    await seed(fixture);
    const kept = await createPlan(fixture, ANA, "School fair");
    const done = await createPlan(fixture, BEN, "Last month's picnic");
    await fixture.plans.archiveHouseholdEventPlan({
      callerUserId: CAI,
      planId: done.id,
      expectedVersion: done.version,
    });

    for (const callerUserId of [ANA, BEN, CAI]) {
      expect(
        (await fixture.plans.listHouseholdEventPlans({ callerUserId, status: "active" })).map(
          (entry) => entry.plan.id,
        ),
      ).toEqual([kept.id]);
      expect(
        (await fixture.plans.listHouseholdEventPlans({ callerUserId })).map(
          (entry) => entry.plan.id,
        ),
      ).toEqual([kept.id, done.id]);
    }
  });
});

describe("optimistic concurrency", () => {
  it("refuses a write fenced on a version someone else has moved past", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);

    await fixture.plans.updateHouseholdEventPlan({
      callerUserId: BEN,
      planId: plan.id,
      expectedVersion: 1,
      draft: { title: "Saturday school fair", details: "Ben got there first." },
    });

    const conflict = await fixture.plans
      .updateHouseholdEventPlan({
        callerUserId: CAI,
        planId: plan.id,
        expectedVersion: 1,
        draft: { title: "Saturday school fair", details: "Cai's version." },
      })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(HouseholdEventPlanConflictError);
    // The member is shown the value that beat them and who wrote it, so the
    // surface can offer keep, revise, or replace rather than merging prose.
    expect((conflict as HouseholdEventPlanConflictError).current).toMatchObject({
      details: "Ben got there first.",
      lastActorUserId: BEN,
      version: 2,
    });
    expect(storedPlan(fixture, plan.id)).toMatchObject({
      details: "Ben got there first.",
      lastActorUserId: BEN,
      version: 2,
    });
  });

  it("lets a member through when they fence on the version they were shown", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    const current = await fixture.plans.getHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
    });

    const written = await fixture.plans.updateHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
      expectedVersion: current.plan.version,
      draft: { title: "Saturday school fair", details: "Cai's version." },
    });

    expect(written).toMatchObject({ details: "Cai's version.", lastActorUserId: CAI, version: 2 });
  });

  it("fences archive and restore too", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    await fixture.plans.updateHouseholdEventPlan({
      callerUserId: BEN,
      planId: plan.id,
      expectedVersion: 1,
      draft: { title: "Renamed by Ben" },
    });

    await expect(
      fixture.plans.archiveHouseholdEventPlan({
        callerUserId: CAI,
        planId: plan.id,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(HouseholdEventPlanConflictError);
    expect(storedPlan(fixture, plan.id)).toMatchObject({ status: "active", version: 2 });
  });
});

describe("archive as the only removal path", () => {
  it("offers no way for a member to delete a workspace-owned plan", async () => {
    await seed(fixture);
    expect(Object.keys(fixture.plans)).not.toContain("deleteHouseholdEventPlan");
    expect(Object.keys(fixture.plans).filter((name) => /delete|destroy|purge/i.test(name))).toEqual(
      [],
    );
  });

  it("closes an archived plan to edits until someone brings it back", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    seedTarget(fixture, {
      recordId: "action-1",
      ownerUserId: BEN,
      scope: "household",
      householdId: household.id,
    });

    const archived = await fixture.plans.archiveHouseholdEventPlan({
      callerUserId: BEN,
      planId: plan.id,
      expectedVersion: plan.version,
    });

    await expect(
      fixture.plans.updateHouseholdEventPlan({
        callerUserId: BEN,
        planId: plan.id,
        expectedVersion: archived.version,
        draft: { title: "Still editing" },
      }),
    ).rejects.toThrow(/archived/i);
    await expect(
      fixture.plans.linkHouseholdEventPlanRecord({
        callerUserId: BEN,
        planId: plan.id,
        linkKind: "general_action",
        recordId: "action-1",
      }),
    ).rejects.toThrow(/archived/i);
    // Archived is not gone: every member can still read it.
    expect(
      (await fixture.plans.getHouseholdEventPlan({ callerUserId: CAI, planId: plan.id })).plan,
    ).toMatchObject({ status: "archived" });

    const restored = await fixture.plans.restoreHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
      expectedVersion: archived.version,
    });
    await expect(
      fixture.plans.updateHouseholdEventPlan({
        callerUserId: BEN,
        planId: plan.id,
        expectedVersion: restored.version,
        draft: { title: "Editable again" },
      }),
    ).resolves.toMatchObject({ title: "Editable again" });
  });

  it("treats a second archive, and a restore of an active plan, as nothing to do", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);

    const archived = await fixture.plans.archiveHouseholdEventPlan({
      callerUserId: ANA,
      planId: plan.id,
      expectedVersion: plan.version,
    });
    // Idempotent, and deliberately unfenced: pressing archive twice is not a
    // concurrency conflict.
    expect(
      await fixture.plans.archiveHouseholdEventPlan({
        callerUserId: BEN,
        planId: plan.id,
        expectedVersion: plan.version,
      }),
    ).toMatchObject({ status: "archived", version: archived.version });
    expect(
      await fixture.plans.restoreHouseholdEventPlan({
        callerUserId: BEN,
        planId: plan.id,
        expectedVersion: archived.version,
      }),
    ).toMatchObject({ status: "active" });
    expect(
      await fixture.plans.restoreHouseholdEventPlan({
        callerUserId: BEN,
        planId: plan.id,
        expectedVersion: archived.version,
      }),
    ).toMatchObject({ status: "active" });
  });
});

describe("linking existing records", () => {
  it("links a record the member can currently see", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    seedTarget(fixture, {
      recordId: "action-1",
      ownerUserId: BEN,
      scope: "household",
      householdId: household.id,
    });

    const link = await fixture.plans.linkHouseholdEventPlanRecord({
      callerUserId: CAI,
      planId: plan.id,
      linkKind: "general_action",
      recordId: "action-1",
    });

    expect(link).toMatchObject({
      planId: plan.id,
      linkKind: "general_action",
      recordId: "action-1",
      linkedByUserId: CAI,
    });
    expect(await linkIdsFor(fixture, ANA, plan.id)).toEqual(["action-1"]);
  });

  /**
   * A surface cannot render an id, so a proved link has to arrive with the name
   * of the thing it points at. It comes from the same read that produced the
   * authorization facts, and it is the target's heading only - never its body.
   */
  it("names every proved link by its target's own title", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    seedTarget(fixture, {
      recordId: "action-1",
      ownerUserId: BEN,
      scope: "household",
      householdId: household.id,
      title: "Bring the folding chairs",
    });
    await fixture.plans.linkHouseholdEventPlanRecord({
      callerUserId: BEN,
      planId: plan.id,
      linkKind: "general_action",
      recordId: "action-1",
    });

    expect(await linkTitlesFor(fixture, CAI, plan.id)).toEqual(["Bring the folding chairs"]);
    const [listed] = await fixture.plans.listHouseholdEventPlans({ callerUserId: CAI });
    expect(listed?.links).toMatchObject([
      { linkKind: "general_action", recordId: "action-1", title: "Bring the folding chairs" },
    ]);
  });

  it("refuses to pull in a record the member could not read themselves", async () => {
    await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    seedTarget(fixture, {
      recordId: "action-private",
      ownerUserId: BEN,
      scope: "private",
      householdId: null,
    });

    for (const recordId of ["action-private", "action-nonexistent"]) {
      await expect(
        fixture.plans.linkHouseholdEventPlanRecord({
          callerUserId: CAI,
          planId: plan.id,
          linkKind: "general_action",
          recordId,
        }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    }
    expect(await linkIdsFor(fixture, ANA, plan.id)).toEqual([]);
  });

  it("holds one plan to its link limit", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    for (let index = 0; index <= HOUSEHOLD_EVENT_PLAN_LINK_LIMIT; index += 1) {
      seedTarget(fixture, {
        recordId: `action-${index}`,
        ownerUserId: BEN,
        scope: "household",
        householdId: household.id,
      });
    }

    for (let index = 0; index < HOUSEHOLD_EVENT_PLAN_LINK_LIMIT; index += 1) {
      await fixture.plans.linkHouseholdEventPlanRecord({
        callerUserId: ANA,
        planId: plan.id,
        linkKind: "general_action",
        recordId: `action-${index}`,
      });
    }

    await expect(
      fixture.plans.linkHouseholdEventPlanRecord({
        callerUserId: ANA,
        planId: plan.id,
        linkKind: "general_action",
        recordId: `action-${HOUSEHOLD_EVENT_PLAN_LINK_LIMIT}`,
      }),
    ).rejects.toThrow(`up to ${HOUSEHOLD_EVENT_PLAN_LINK_LIMIT} records`);
    expect(await linkIdsFor(fixture, ANA, plan.id)).toHaveLength(HOUSEHOLD_EVENT_PLAN_LINK_LIMIT);
  });

  /**
   * A link is proved on every read rather than trusted from when it was made,
   * because the target's audience can narrow afterwards. The Plan itself is
   * unchanged and stays whole-household: only the link disappears, and only for
   * the reader who lost the target.
   *
   * The refused link leaves nothing at all - not the title the granted readers
   * see, and not a placeholder row standing where it was. A count or an
   * "unavailable" stub would be the existence signal ADR 0219 forbids.
   */
  it("drops a link from the view of a reader who can no longer see its target", async () => {
    const household = await seed(fixture);
    const plan = await createPlan(fixture, ANA);
    seedTarget(fixture, {
      recordId: "action-1",
      ownerUserId: BEN,
      scope: "household",
      householdId: household.id,
      title: "Bring the folding chairs",
    });
    await fixture.plans.linkHouseholdEventPlanRecord({
      callerUserId: BEN,
      planId: plan.id,
      linkKind: "general_action",
      recordId: "action-1",
    });
    expect(await linkIdsFor(fixture, CAI, plan.id)).toEqual(["action-1"]);

    // BEN re-scopes their action to a selected audience of ANA alone.
    seedTarget(fixture, {
      recordId: "action-1",
      ownerUserId: BEN,
      scope: "shared",
      householdId: household.id,
      title: "Bring the folding chairs",
    });
    await fixture.store.households.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "general_action",
      recordId: "action-1",
      sharedWithUserId: ANA,
      sharedByUserId: BEN,
    });

    expect(await linkTitlesFor(fixture, ANA, plan.id)).toEqual(["Bring the folding chairs"]);
    expect(await linkIdsFor(fixture, BEN, plan.id)).toEqual(["action-1"]);
    expect(await linkIdsFor(fixture, CAI, plan.id)).toEqual([]);
    // The Plan is not narrowed by the link it can no longer show, and nothing of
    // the refused link survives anywhere in what CAI is handed.
    const refused = await fixture.plans.listHouseholdEventPlans({ callerUserId: CAI });
    expect(refused.map((entry) => entry.plan.id)).toEqual([plan.id]);
    expect(refused[0]?.links).toEqual([]);
    expect(JSON.stringify(refused)).not.toMatch(/folding chairs|action-1/);
  });
});

describe("finding the plan for a calendar event", () => {
  async function planWithCalendarEvent(callerUserId: string, providerEventId: string) {
    return fixture.plans.createHouseholdEventPlan({
      callerUserId,
      draft: {
        title: "Saturday school fair",
        calendarEvent: { connectionId: CONNECTION, calendarId: CALENDAR, providerEventId },
      },
    });
  }

  it("finds another member's plan for an event the caller may see", async () => {
    await seed(fixture);
    const plan = await planWithCalendarEvent(ANA, "evt-1");

    expect(
      await fixture.plans.findPlanForCalendarEvent({
        callerUserId: CAI,
        connectionId: CONNECTION,
        providerEventId: "evt-1",
      }),
    ).toMatchObject({ id: plan.id, createdByUserId: ANA });
  });

  it("returns nothing for an event no plan is about, or whose plan is archived", async () => {
    await seed(fixture);
    const plan = await planWithCalendarEvent(ANA, "evt-1");

    expect(
      await fixture.plans.findPlanForCalendarEvent({
        callerUserId: CAI,
        connectionId: CONNECTION,
        providerEventId: "evt-other",
      }),
    ).toBeNull();
    expect(
      await fixture.plans.findPlanForCalendarEvent({
        callerUserId: CAI,
        connectionId: "connection-elsewhere",
        providerEventId: "evt-1",
      }),
    ).toBeNull();

    await fixture.plans.archiveHouseholdEventPlan({
      callerUserId: CAI,
      planId: plan.id,
      expectedVersion: plan.version,
    });
    expect(
      await fixture.plans.findPlanForCalendarEvent({
        callerUserId: CAI,
        connectionId: CONNECTION,
        providerEventId: "evt-1",
      }),
    ).toBeNull();
  });

  it("tells someone outside the household nothing at all", async () => {
    await seed(fixture);
    await planWithCalendarEvent(ANA, "evt-1");

    await expect(
      fixture.plans.findPlanForCalendarEvent({
        callerUserId: DEE,
        connectionId: CONNECTION,
        providerEventId: "evt-1",
      }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });
});
