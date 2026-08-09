import { HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createContextFactQueries, createInMemoryContextFactStore } from "../context-facts";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import { createHouseholdLifecycle } from "../households/lifecycle";

const ANA = "user-ana";
const BEN = "user-ben";
const OUTSIDER = "user-outsider";
const NEIGHBOUR = "user-neighbour";

const verifiedCallerFor = (userId: string) => async () => userId;

/**
 * Two active members of one household, one member of a different household, and
 * one person in no household at all.
 *
 * The matrix below is written against standing rather than against a sequence of
 * mutations: every case is "who is this, and what are they in", which is exactly
 * what the Household Authorization Proof decides on.
 */
async function householdFixture() {
  const householdStore = createInMemoryHouseholdStore();
  const lifecycle = createHouseholdLifecycle(householdStore);
  const { household } = await lifecycle.createHousehold({ ownerUserId: ANA, name: "Home" });
  await lifecycle.inviteMember({
    ownerUserId: ANA,
    householdId: household.id,
    invitedUserId: BEN,
  });
  await lifecycle.acceptInvite({ householdId: household.id, userId: BEN });
  const neighbour = await lifecycle.createHousehold({
    ownerUserId: NEIGHBOUR,
    name: "Next door",
  });

  const store = createInMemoryContextFactStore([], { householdAccess: householdStore });
  const queriesFor = (userId: string) =>
    createContextFactQueries(store, {
      householdAccess: householdStore,
      resolveVerifiedCaller: verifiedCallerFor(userId),
    });

  return {
    household,
    neighbourHousehold: neighbour.household,
    householdStore,
    store,
    queriesFor,
    async removeMember(userId: string) {
      const membership = await householdStore.getHouseholdMembership({
        householdId: household.id,
        userId,
      });
      if (!membership) throw new Error("Expected an active membership fixture.");
      await householdStore.updateHouseholdMembership({
        membershipId: membership.id,
        patch: { status: "removed", removedAt: new Date() },
      });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof householdFixture>>;

async function seedFact(
  fixture: Fixture,
  overrides: { callerUserId?: string; category?: "location" | "preference"; content?: string } = {},
) {
  const callerUserId = overrides.callerUserId ?? ANA;
  const outcome = await fixture.queriesFor(callerUserId).createHouseholdContextFact({
    callerUserId,
    category: overrides.category ?? "location",
    content: overrides.content ?? "We're in the Lents neighbourhood.",
  });
  if (outcome.result.outcome !== "saved") throw new Error("Expected the seed write to save.");
  return outcome.result.fact;
}

describe("Household Context authority", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await householdFixture();
  });

  it("gives an Owner and a Member the identical write, archive, and restore authority", async () => {
    // The same four presses run twice, once from each side of the role
    // boundary. Owner status must buy nothing.
    for (const actor of [ANA, BEN]) {
      const queries = fixture.queriesFor(actor);
      const created = await queries.createHouseholdContextFact({
        callerUserId: actor,
        category: "preference",
        content: `Quiet after nine, said by ${actor}.`,
      });
      expect(created.result).toMatchObject({ outcome: "saved", decision: "created" });
      if (created.result.outcome !== "saved") throw new Error("unreachable");

      const other = actor === ANA ? BEN : ANA;
      const otherQueries = fixture.queriesFor(other);
      const updated = await otherQueries.updateHouseholdContextFact({
        callerUserId: other,
        contextFactId: created.result.fact.id,
        expectedUpdatedAt: created.result.fact.updatedAt,
        category: "preference",
        content: `Quiet after ten, corrected by ${other}.`,
        sensitivity: "normal",
      });
      expect(updated.result).toMatchObject({ outcome: "saved", decision: "updated" });
      if (updated.result.outcome !== "saved") throw new Error("unreachable");

      const archived = await otherQueries.archiveHouseholdContextFact({
        callerUserId: other,
        contextFactId: created.result.fact.id,
        expectedUpdatedAt: updated.result.fact.updatedAt,
      });
      expect(archived.result).toMatchObject({ outcome: "saved", decision: "archived" });
      if (archived.result.outcome !== "saved") throw new Error("unreachable");

      const restored = await queries.restoreHouseholdContextFact({
        callerUserId: actor,
        contextFactId: created.result.fact.id,
        expectedUpdatedAt: archived.result.fact.updatedAt,
      });
      expect(restored.result).toMatchObject({ outcome: "saved", decision: "restored" });
    }
  });

  it("keeps the creator's attribution while recording whoever acted last", async () => {
    const fact = await seedFact(fixture);
    const updated = await fixture.queriesFor(BEN).updateHouseholdContextFact({
      callerUserId: BEN,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We moved over to Sellwood.",
      sensitivity: "normal",
    });
    if (updated.result.outcome !== "saved") throw new Error("Expected a saved outcome.");
    expect(updated.result.fact.actorAttribution).toEqual({
      creatorUserId: ANA,
      lastActorUserId: BEN,
    });
  });

  it("fans cache invalidation out to every active member and the household", async () => {
    const created = await fixture.queriesFor(ANA).createHouseholdContextFact({
      callerUserId: ANA,
      category: "location",
      content: "We're in the Lents neighbourhood.",
    });
    expect(created.affectedScopes).toEqual(
      expect.arrayContaining([
        { kind: "owner-collection", collection: "orientation", ownerUserId: ANA },
        { kind: "owner-collection", collection: "orientation", ownerUserId: BEN },
        {
          kind: "household-collection",
          collection: "context-facts",
          householdId: fixture.household.id,
        },
      ]),
    );
  });
});

describe("Household Context isolation", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await householdFixture();
  });

  it.each([
    ["an outsider in no household", () => OUTSIDER],
    ["a member of a different household", () => NEIGHBOUR],
  ])("refuses %s every operation with one opaque outcome", async (_label, callerFor) => {
    const fact = await seedFact(fixture);
    const caller = callerFor();
    const queries = fixture.queriesFor(caller);

    await expect(queries.listHouseholdContextFacts({ callerUserId: caller })).resolves.toEqual([]);
    for (const attempt of [
      () =>
        queries.updateHouseholdContextFact({
          callerUserId: caller,
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt,
          category: "location",
          content: "An outsider must not write here.",
          sensitivity: "normal",
        }),
      () =>
        queries.archiveHouseholdContextFact({
          callerUserId: caller,
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt,
        }),
      () =>
        queries.restoreHouseholdContextFact({
          callerUserId: caller,
          contextFactId: fact.id,
          expectedUpdatedAt: fact.updatedAt,
        }),
    ]) {
      const error = await attempt().catch((raised: Error) => raised);
      expect(error).toBeInstanceOf(Error);
      // Never the household's name, the fact's content, or which gate refused.
      expect((error as Error).message).not.toContain("Lents");
      expect((error as Error).message).not.toContain(fixture.household.id);
    }
  });

  it("revokes a departed member immediately without touching the household's facts", async () => {
    const fact = await seedFact(fixture, { callerUserId: BEN });
    await fixture.removeMember(BEN);

    const departed = fixture.queriesFor(BEN);
    await expect(departed.listHouseholdContextFacts({ callerUserId: BEN })).resolves.toEqual([]);
    await expect(
      departed.updateHouseholdContextFact({
        callerUserId: BEN,
        contextFactId: fact.id,
        expectedUpdatedAt: fact.updatedAt,
        category: "location",
        content: "A departed member must not write here.",
        sensitivity: "normal",
      }),
    ).rejects.toThrow();

    // Departure revokes access. It does not rewrite what the person wrote.
    const remaining = await fixture
      .queriesFor(ANA)
      .listHouseholdContextFacts({ callerUserId: ANA });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      content: "We're in the Lents neighbourhood.",
      actorAttribution: { creatorUserId: BEN, lastActorUserId: BEN },
    });
  });

  it("never lets a caller point a read at a household they are not in", async () => {
    await fixture.queriesFor(NEIGHBOUR).createHouseholdContextFact({
      callerUserId: NEIGHBOUR,
      category: "location",
      content: "The neighbours have a shared garden.",
    });
    await expect(
      fixture.queriesFor(ANA).listHouseholdContextFacts({ callerUserId: ANA }),
    ).resolves.toEqual([]);
  });
});

describe("Household Context reconciliation", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await householdFixture();
  });

  it("preserves a stale author's draft and shows the current statement and actor", async () => {
    const fact = await seedFact(fixture);
    const winner = await fixture.queriesFor(BEN).updateHouseholdContextFact({
      callerUserId: BEN,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We moved over to Sellwood.",
      sensitivity: "normal",
    });
    if (winner.result.outcome !== "saved") throw new Error("Expected the first write to save.");

    const stale = await fixture.queriesFor(ANA).updateHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      // The version Ana was looking at, which Ben has since replaced.
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We're moving to Sellwood in the spring.",
      sensitivity: "normal",
    });

    expect(stale.result.outcome).toBe("stale");
    if (stale.result.outcome !== "stale") throw new Error("unreachable");
    expect(stale.result.reconciliation.draft).toEqual({
      category: "location",
      content: "We're moving to Sellwood in the spring.",
      sensitivity: "normal",
    });
    expect(stale.result.reconciliation.current).toMatchObject({
      content: "We moved over to Sellwood.",
      lastActorUserId: BEN,
      lifecycle: "active",
    });
    expect(stale.result.reconciliation.choices).toEqual(["keep_current", "revise", "replace"]);
    // A refused write changed nothing, so nothing downstream is revalidated.
    expect(stale.affectedScopes).toEqual([]);
    // And the household's current truth is untouched by the refused press.
    const current = await fixture.queriesFor(BEN).listHouseholdContextFacts({ callerUserId: BEN });
    expect(current[0]?.content).toBe("We moved over to Sellwood.");
  });

  it("converges: replacing means resubmitting against the version just shown", async () => {
    const fact = await seedFact(fixture);
    const winner = await fixture.queriesFor(BEN).updateHouseholdContextFact({
      callerUserId: BEN,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We moved over to Sellwood.",
      sensitivity: "normal",
    });
    if (winner.result.outcome !== "saved") throw new Error("unreachable");

    const stale = await fixture.queriesFor(ANA).updateHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We're moving to Sellwood in the spring.",
      sensitivity: "normal",
    });
    if (stale.result.outcome !== "stale") throw new Error("unreachable");

    const replaced = await fixture.queriesFor(ANA).updateHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: stale.result.reconciliation.current.updatedAt,
      ...stale.result.reconciliation.draft,
    });
    expect(replaced.result).toMatchObject({ outcome: "saved", decision: "updated" });
    if (replaced.result.outcome !== "saved") throw new Error("unreachable");
    expect(replaced.result.fact.content).toBe("We're moving to Sellwood in the spring.");
    expect(replaced.result.fact.actorAttribution?.lastActorUserId).toBe(ANA);
  });

  it("withholds replace when the current statement was archived instead of changed", async () => {
    const fact = await seedFact(fixture);
    await fixture.queriesFor(BEN).archiveHouseholdContextFact({
      callerUserId: BEN,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
    });

    const stale = await fixture.queriesFor(ANA).updateHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
      category: "location",
      content: "We're moving to Sellwood in the spring.",
      sensitivity: "normal",
    });
    if (stale.result.outcome !== "stale") throw new Error("Expected a stale outcome.");
    expect(stale.result.reconciliation.current.lifecycle).toBe("archived");
    expect(stale.result.reconciliation.choices).toEqual(["keep_current", "revise"]);
  });

  it("refuses an unfenced write outright rather than letting it win by arriving later", async () => {
    const fact = await seedFact(fixture);
    await expect(
      fixture.queriesFor(BEN).updateHouseholdContextFact({
        callerUserId: BEN,
        contextFactId: fact.id,
        category: "location",
        content: "No version, no write.",
        sensitivity: "normal",
      } as never),
    ).rejects.toThrow();
  });

  it("focuses the existing fact instead of creating a second current answer", async () => {
    await seedFact(fixture);
    const conflict = await fixture
      .queriesFor(BEN)
      .createHouseholdContextFact({
        callerUserId: BEN,
        category: "location",
        content: "We're over in Sellwood.",
      })
      .catch((error: Error & { existingFactId?: string }) => error);

    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as { existingFactId?: string }).existingFactId).toBeDefined();
  });

  it("treats a re-archive as the state the presser wanted, not a collision", async () => {
    const fact = await seedFact(fixture);
    const archived = await fixture.queriesFor(ANA).archiveHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
    });
    if (archived.result.outcome !== "saved") throw new Error("unreachable");

    const again = await fixture.queriesFor(BEN).archiveHouseholdContextFact({
      callerUserId: BEN,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
    });
    expect(again.result).toMatchObject({ outcome: "saved", decision: "archived" });
  });

  it("refuses to restore an archived fact the household has already replaced", async () => {
    const fact = await seedFact(fixture);
    const archived = await fixture.queriesFor(ANA).archiveHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
    });
    if (archived.result.outcome !== "saved") throw new Error("unreachable");
    await seedFact(fixture, { callerUserId: BEN });

    await expect(
      fixture.queriesFor(BEN).restoreHouseholdContextFact({
        callerUserId: BEN,
        contextFactId: fact.id,
        expectedUpdatedAt: archived.result.fact.updatedAt,
      }),
    ).rejects.toThrow(/already/i);
  });

  it("offers no permanent deletion of a household-owned fact", () => {
    const queries = fixture.queriesFor(ANA) as Record<string, unknown>;
    expect(queries.deleteHouseholdContextFact).toBeUndefined();
  });
});

describe("Household Context disclosure", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await householdFixture();
  });

  async function seedRestricted() {
    const created = await fixture.queriesFor(ANA).createHouseholdContextFact({
      callerUserId: ANA,
      category: "constraint",
      content: "One of us is off work on Thursdays.",
      sensitivity: "restricted",
    });
    if (created.result.outcome !== "saved") throw new Error("unreachable");
    return created.result.fact;
  }

  it("shows a restricted fact on the direct management surface for every member", async () => {
    const restricted = await seedRestricted();
    const facts = await fixture.queriesFor(BEN).listHouseholdContextFacts({ callerUserId: BEN });
    expect(facts.map((fact) => fact.id)).toContain(restricted.id);
  });

  it("keeps a restricted fact out of anything nobody pointed at", async () => {
    const restricted = await seedRestricted();

    const ambient = await fixture
      .queriesFor(BEN)
      .listHouseholdContextFacts({ callerUserId: BEN, purpose: "ambient" });
    expect(ambient.map((fact) => fact.id)).not.toContain(restricted.id);

    const orientation = await fixture.queriesFor(BEN).getOrientationContext({ callerUserId: BEN });
    expect(orientation.context.facts.map((fact) => fact.content)).not.toContain(
      "One of us is off work on Thursdays.",
    );
  });

  it("returns a restricted fact to exact recall only on a direct request", async () => {
    await seedRestricted();
    const ambient = await fixture.queriesFor(BEN).searchHouseholdContextFacts({
      callerUserId: BEN,
      query: "Thursdays",
      directlyRequested: false,
      limit: 5,
    });
    expect(ambient).toEqual([]);

    const direct = await fixture.queriesFor(BEN).searchHouseholdContextFacts({
      callerUserId: BEN,
      query: "Thursdays",
      directlyRequested: true,
      limit: 5,
    });
    expect(direct.map((result) => result.fact.content)).toEqual([
      "One of us is off work on Thursdays.",
    ]);
  });

  it("keeps archived facts out of exact recall entirely", async () => {
    const fact = await seedFact(fixture);
    await fixture.queriesFor(ANA).archiveHouseholdContextFact({
      callerUserId: ANA,
      contextFactId: fact.id,
      expectedUpdatedAt: fact.updatedAt,
    });
    await expect(
      fixture.queriesFor(BEN).searchHouseholdContextFacts({
        callerUserId: BEN,
        query: "Lents",
        directlyRequested: true,
        limit: 5,
      }),
    ).resolves.toEqual([]);
  });

  it("carries a household fact into every active member's orientation", async () => {
    await seedFact(fixture);
    const orientation = await fixture.queriesFor(BEN).getOrientationContext({ callerUserId: BEN });
    expect(orientation.context.facts).toEqual([
      expect.objectContaining({
        subject: { kind: "household", householdId: fixture.household.id },
        content: "We're in the Lents neighbourhood.",
        trust: "untrusted_data",
        authority: "none",
      }),
    ]);
  });

  it("drops a household fact out of orientation the moment membership ends", async () => {
    await seedFact(fixture);
    await fixture.removeMember(BEN);
    const orientation = await fixture.queriesFor(BEN).getOrientationContext({ callerUserId: BEN });
    expect(orientation.context.facts).toEqual([]);
  });

  it("refuses a precise address or a raw secret before it reaches shared storage", async () => {
    await expect(
      fixture.queriesFor(ANA).createHouseholdContextFact({
        callerUserId: ANA,
        category: "location",
        content: "We live at 1600 Pennsylvania Avenue.",
      }),
    ).rejects.toThrow();
  });

  it("has one sentence for every refusal, and it names nothing", () => {
    expect(HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE).toBe("That's no longer available.");
  });
});
