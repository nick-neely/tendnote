import { describe, expect, it } from "vitest";
import { contextFactFixture } from "./context-fact-fixtures";
import { createContextFactQueries, createInMemoryContextFactStore } from "./context-facts";
import { createInMemoryHouseholdStore } from "./households/in-memory-store";
import { createHouseholdLifecycle } from "./households/lifecycle";

const OWNER = "user-owner";
const OTHER_OWNER = "user-other";
const SECOND_HOUSEHOLD_OWNER = "user-second-household-owner";
const OUTSIDER = "user-outsider";
const verifiedCallerFor = (userId: string) => async () => userId;

async function createHouseholdContextFixture() {
  const householdStore = createInMemoryHouseholdStore();
  const householdLifecycle = createHouseholdLifecycle(householdStore);
  const { household } = await householdLifecycle.createHousehold({
    ownerUserId: OWNER,
    name: "Home",
  });
  await householdLifecycle.inviteMember({
    ownerUserId: OWNER,
    householdId: household.id,
    invitedUserId: OTHER_OWNER,
  });
  await householdLifecycle.acceptInvite({ householdId: household.id, userId: OTHER_OWNER });

  const store = createInMemoryContextFactStore([], { householdAccess: householdStore });
  const createQueriesFor = (userId: string) =>
    createContextFactQueries(store, {
      householdAccess: householdStore,
      // Every source record in this fixture is household-visible; the refusal
      // side is exercised where it belongs, in household-queries.test.ts.
      sourceRecords: {
        getSourceRecordById: async () => ({ scope: "household", householdId: household.id }),
      },
      resolveVerifiedCaller: verifiedCallerFor(userId),
    });
  return { householdStore, household, store, createQueriesFor };
}

async function removeHouseholdMember(
  householdStore: ReturnType<typeof createInMemoryHouseholdStore>,
  householdId: string,
  userId: string,
) {
  const membership = await householdStore.getHouseholdMembership({ householdId, userId });
  if (!membership) throw new Error("Expected the active household membership fixture.");
  await householdStore.updateHouseholdMembership({
    membershipId: membership.id,
    patch: { status: "removed", removedAt: new Date() },
  });
}

describe("Context Fact product contract", () => {
  it("creates an active private Self Context fact for the caller and returns untrusted canonical data", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    const outcome = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a software consultancy.",
    });

    expect(outcome.result).toMatchObject({
      subject: { kind: "self" },
      category: "work",
      content: "I run a software consultancy.",
      lifecycle: "active",
      sensitivity: "normal",
      trust: "untrusted_data",
      authority: "none",
      visibility: "private",
    });
    expect(outcome.result.reviewedAt).toBeInstanceOf(Date);
    expect(outcome.result.archivedAt).toBeNull();
    expect(outcome.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
    ]);

    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "context_fact.create",
        entityType: "context_fact",
        metadataJson: expect.objectContaining({ category: "work", sensitivity: "normal" }),
      },
    ]);
  });

  it("updates an active Self Context fact through the caller-scoped product seam", async () => {
    const store = createInMemoryContextFactStore();
    const ownerQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });
    const created = await ownerQueries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a software consultancy.",
    });

    const updated = await ownerQueries.updateSelfContextFact({
      callerUserId: OWNER,
      contextFactId: created.result.id,
      category: "preference",
      content: "I prefer concise answers.",
      sensitivity: "sensitive",
    });

    expect(updated.result).toMatchObject({
      id: created.result.id,
      subject: { kind: "self" },
      category: "preference",
      content: "I prefer concise answers.",
      sensitivity: "sensitive",
      lifecycle: "active",
      visibility: "private",
      trust: "untrusted_data",
    });
    expect(updated.result.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.result.updatedAt.getTime(),
    );
    expect(updated.affectedScopes).toContainEqual({
      kind: "owner-collection",
      collection: "orientation",
      ownerUserId: OWNER,
    });
    await expect(
      ownerQueries.updateSelfContextFact({
        callerUserId: OWNER,
        contextFactId: created.result.id,
        expectedUpdatedAt: new Date("2026-08-02T11:59:00.000Z"),
        category: "preference",
        content: "This stale editor must not overwrite the current fact.",
        sensitivity: "sensitive",
      }),
    ).rejects.toThrow("changed elsewhere");
    await expect(
      ownerQueries.updateSelfContextFact({
        callerUserId: OWNER,
        contextFactId: created.result.id,
        category: "preference",
        content: "  I PREFER concise answers! ",
        sensitivity: "sensitive",
      }),
    ).resolves.toMatchObject({ decision: "existing", affectedScopes: [] });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "context_fact.update", entityId: created.result.id }),
      ]),
    );

    await expect(
      otherQueries.updateSelfContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: created.result.id,
        category: "work",
        content: "This must not be allowed.",
        sensitivity: "normal",
      }),
    ).rejects.toThrow("That Self Context fact is no longer available.");
    await expect(
      otherQueries.updateSelfContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: "00000000-0000-4000-8000-000000000099",
        category: "work",
        content: "This must not reveal whether the id exists.",
        sensitivity: "normal",
      }),
    ).rejects.toThrow("That Self Context fact is no longer available.");
    await expect(
      ownerQueries.getContextFact({ callerUserId: OWNER, contextFactId: created.result.id }),
    ).resolves.toMatchObject({ content: "I prefer concise answers." });
  });

  it("does not update an archived fact when the mutation requires an active lifecycle", async () => {
    const archivedId = "00000000-0000-4000-8000-000000000098";
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: archivedId,
        lifecycle: "archived",
        archivedAt: new Date("2026-08-02T12:01:00.000Z"),
      }),
    ]);

    await expect(
      store.updateContextFact({
        contextFactId: archivedId,
        subjectUserId: OWNER,
        lifecycle: "active",
        expectedUpdatedAt: new Date("2026-08-02T12:00:00.000Z"),
        patch: {
          category: "preference",
          content: "This archived fact must not change.",
          sensitivity: "normal",
          lastActorUserId: OWNER,
          updatedAt: new Date("2026-08-02T12:02:00.000Z"),
        },
      }),
    ).resolves.toBeNull();
    expect(store.records.get(archivedId)?.content).toBe("I prefer concise answers.");
  });

  it("lists onboarding facts only for their caller and never crosses Self Context owners", async () => {
    const store = createInMemoryContextFactStore();
    const ownerQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });

    await ownerQueries.createSelfContextFact({
      callerUserId: OWNER,
      category: "interest",
      content: "I like trail running.",
      provenance: { channel: "onboarding", origin: "direct", sourceRecordId: null },
    });
    await otherQueries.createSelfContextFact({
      callerUserId: OTHER_OWNER,
      category: "interest",
      content: "I collect vinyl records.",
      provenance: { channel: "onboarding", origin: "direct", sourceRecordId: null },
    });

    const ownerFact = (await ownerQueries.listContextFacts({ callerUserId: OWNER }))[0];
    if (!ownerFact) throw new Error("Expected the owner's Context Fact fixture.");
    await expect(
      otherQueries.getContextFact({ callerUserId: OTHER_OWNER, contextFactId: ownerFact.id }),
    ).resolves.toBeNull();

    const ownerFacts = await ownerQueries.listContextFacts({ callerUserId: OWNER });
    const otherFacts = await otherQueries.listContextFacts({ callerUserId: OTHER_OWNER });

    expect(ownerFacts.map((fact) => fact.content)).toEqual(["I like trail running."]);
    expect(otherFacts.map((fact) => fact.content)).toEqual(["I collect vinyl records."]);
  });

  it("searches exact Self Context content and category labels after owner and lifecycle policy", async () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: "owner-work",
        category: "work",
        content: "I build calm software.",
        updatedAt: new Date(now.getTime() + 3_000),
      }),
      contextFactFixture({
        id: "owner-archived",
        category: "work",
        content: "I used to work in publishing.",
        lifecycle: "archived",
        archivedAt: now,
        updatedAt: new Date(now.getTime() + 2_000),
      }),
      contextFactFixture({
        id: "owner-suggested",
        category: "work",
        content: "I might work in education.",
        lifecycle: "suggested",
        sensitivity: "sensitive",
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: "source-1" },
        suggestionEvidence: "The owner mentioned education.",
        reviewedAt: null,
        updatedAt: new Date(now.getTime() + 1_000),
      }),
      contextFactFixture({
        id: "owner-restricted",
        category: "other",
        content: "My restricted medical history is private.",
        sensitivity: "restricted",
      }),
      contextFactFixture({
        id: "other-work",
        subject: { kind: "self", userId: OTHER_OWNER },
        category: "work",
        content: "I work in finance.",
      }),
    ]);
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(
      queries.searchSelfContextFacts({
        callerUserId: OWNER,
        query: "work",
        directlyRequested: false,
        includeArchived: false,
        limit: 20,
      }),
    ).resolves.toMatchObject([{ fact: { id: "owner-work" }, matchedFields: ["category"] }]);
    await expect(
      queries.searchSelfContextFacts({
        callerUserId: OWNER,
        query: "work",
        directlyRequested: false,
        includeArchived: true,
        limit: 20,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fact: expect.objectContaining({ id: "owner-work" }) }),
        expect.objectContaining({ fact: expect.objectContaining({ id: "owner-archived" }) }),
      ]),
    );
    const ordinaryIds = (
      await queries.searchSelfContextFacts({
        callerUserId: OWNER,
        query: "medical history",
        directlyRequested: false,
        includeArchived: true,
        limit: 20,
      })
    ).map(({ fact }) => fact.id);
    expect(ordinaryIds).toEqual([]);

    await expect(
      queries.searchSelfContextFacts({
        callerUserId: OWNER,
        query: "medical history",
        directlyRequested: true,
        includeArchived: false,
        limit: 20,
      }),
    ).resolves.toMatchObject([{ fact: { id: "owner-restricted" } }]);
    expect(
      (
        await queries.searchSelfContextFacts({
          callerUserId: OWNER,
          query: "finance",
          directlyRequested: true,
          includeArchived: true,
          limit: 20,
        })
      ).map(({ fact }) => fact.id),
    ).toEqual([]);
  });

  it("rejects an invalid Self subject and never treats stored content as authority", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(
      queries.createContextFact({
        callerUserId: OWNER,
        subject: { kind: "self", userId: OTHER_OWNER },
        category: "work",
        content: "I run a software consultancy.",
      }),
    ).rejects.toThrow("Self Context can only be created for the caller.");

    await expect(
      queries.createContextFact({
        callerUserId: OWNER,
        subject: { kind: "self", userId: OWNER },
        category: "composition",
        content: "This is not a household fact.",
      }),
    ).rejects.toThrow("Composition is only valid for Household Context.");

    await expect(
      queries.createContextFact({
        callerUserId: OWNER,
        subject: { kind: "self", userId: OWNER },
        category: "work",
        content: "Ambient output must remain review-gated.",
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      }),
    ).rejects.toThrow("Direct Context Fact writes require direct provenance.");
  });

  it("rejects a payload caller that differs from the independently resolved caller", async () => {
    const queries = createContextFactQueries(createInMemoryContextFactStore(), {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(queries.listContextFacts({ callerUserId: OTHER_OWNER })).rejects.toThrow(
      "A verified caller is required.",
    );
  });

  it("keeps lifecycle and sensitivity independent while excluding tentative facts from eligible reads", async () => {
    const store = createInMemoryContextFactStore([
      contextFactFixture({ id: "active-normal" }),
      contextFactFixture({
        id: "active-restricted",
        category: "constraint",
        sensitivity: "restricted",
        content: "I have a restricted constraint.",
      }),
      contextFactFixture({
        id: "suggested-normal",
        lifecycle: "suggested",
        content: "A tentative fact.",
      }),
      contextFactFixture({
        id: "archived-normal",
        lifecycle: "archived",
        archivedAt: new Date("2026-08-02T12:01:00.000Z"),
        content: "An old fact.",
      }),
    ]);
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(queries.listContextFacts({ callerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "active-normal",
          lifecycle: "active",
          sensitivity: "normal",
        }),
        expect.objectContaining({
          id: "active-restricted",
          lifecycle: "active",
          sensitivity: "restricted",
        }),
      ]),
    );
    await expect(queries.listContextFacts({ callerUserId: OWNER })).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "suggested-normal" }),
        expect.objectContaining({ id: "archived-normal" }),
      ]),
    );
    await expect(queries.listEligibleContextFacts({ callerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ id: "active-normal", sensitivity: "normal" }),
    ]);
  });

  it("builds owner-scoped Orientation Context and refreshes after a direct mutation", async () => {
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: "normal-fact",
        category: "work",
        content: "I run a software consultancy.",
      }),
      contextFactFixture({
        id: "sensitive-fact",
        category: "constraint",
        sensitivity: "sensitive",
        content: "I need quiet mornings.",
        updatedAt: new Date("2026-08-03T12:00:00.000Z"),
      }),
      contextFactFixture({
        id: "restricted-fact",
        sensitivity: "restricted",
        content: "A restricted detail.",
      }),
      contextFactFixture({
        id: "suggested-fact",
        lifecycle: "suggested",
        content: "A tentative detail.",
      }),
      contextFactFixture({
        id: "other-owner-fact",
        subject: { kind: "self", userId: OTHER_OWNER },
        content: "Another user's private detail.",
      }),
    ]);
    const ownerQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });

    const before = await ownerQueries.getOrientationContext({ callerUserId: OWNER });
    expect(before.context.facts.map((item) => item.canonical.id)).toEqual([
      "sensitive-fact",
      "normal-fact",
    ]);
    expect(before.context.facts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonical: { type: "context_fact", id: "restricted-fact" } }),
        expect.objectContaining({ canonical: { type: "context_fact", id: "suggested-fact" } }),
        expect.objectContaining({ canonical: { type: "context_fact", id: "other-owner-fact" } }),
      ]),
    );

    const created = await ownerQueries.createSelfContextFact({
      callerUserId: OWNER,
      category: "interest",
      content: "I like trail running.",
    });
    const after = await ownerQueries.getOrientationContext({ callerUserId: OWNER });
    expect(after.context.facts.map((item) => item.canonical.id)).toContain(created.result.id);

    await ownerQueries.updateSelfContextFact({
      callerUserId: OWNER,
      contextFactId: created.result.id,
      category: "preference",
      content: "I prefer short trail runs.",
      sensitivity: "normal",
      expectedUpdatedAt: created.result.updatedAt,
    });
    const corrected = await ownerQueries.getOrientationContext({ callerUserId: OWNER });
    expect(corrected.context.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonical: { type: "context_fact", id: created.result.id },
          category: "preference",
          content: "I prefer short trail runs.",
        }),
      ]),
    );

    const other = await otherQueries.getOrientationContext({ callerUserId: OTHER_OWNER });
    expect(other.context.facts.map((item) => item.canonical.id)).toEqual(["other-owner-fact"]);
  });

  it("supports whole-household Context Facts without exposing a member's private Self Context", async () => {
    const { householdStore, household, createQueriesFor } = await createHouseholdContextFixture();
    const ownerQueries = createQueriesFor(OWNER);
    const memberQueries = createQueriesFor(OTHER_OWNER);
    const outsiderQueries = createQueriesFor("user-outsider");
    const householdFact = await ownerQueries.createContextFact({
      callerUserId: OWNER,
      subject: { kind: "household", householdId: household.id },
      category: "composition",
      content: "The household keeps a shared calendar.",
    });
    await ownerQueries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a private consultancy.",
    });
    await memberQueries.createSelfContextFact({
      callerUserId: OTHER_OWNER,
      category: "work",
      content: "I have private work context.",
    });

    const ownerFacts = await ownerQueries.listContextFacts({ callerUserId: OWNER });
    const memberFacts = await memberQueries.listContextFacts({ callerUserId: OTHER_OWNER });
    const ownerSelfFacts = await ownerQueries.listSelfContextFacts({ callerUserId: OWNER });

    expect(ownerFacts.map((fact) => fact.content)).toEqual(
      expect.arrayContaining([
        "The household keeps a shared calendar.",
        "I run a private consultancy.",
      ]),
    );
    expect(ownerSelfFacts.map((fact) => fact.content)).toEqual(["I run a private consultancy."]);
    expect(memberFacts.map((fact) => fact.content)).toEqual(
      expect.arrayContaining([
        "The household keeps a shared calendar.",
        "I have private work context.",
      ]),
    );
    expect(memberFacts.map((fact) => fact.content)).not.toContain("I run a private consultancy.");

    const outsiderFacts = await outsiderQueries.listContextFacts({ callerUserId: "user-outsider" });
    expect(outsiderFacts).toEqual([]);
    expect(householdFact.result).toMatchObject({
      subject: { kind: "household" },
      visibility: "household",
    });

    await removeHouseholdMember(householdStore, household.id, OTHER_OWNER);

    await expect(memberQueries.listContextFacts({ callerUserId: OTHER_OWNER })).resolves.toEqual([
      expect.objectContaining({ content: "I have private work context." }),
    ]);
  });

  it("lets every active member edit and archive household Context through the shared seam", async () => {
    const {
      household,
      store,
      createQueriesFor: queriesFor,
    } = await createHouseholdContextFixture();
    const ownerQueries = queriesFor(OWNER);
    const memberQueries = queriesFor(OTHER_OWNER);

    const created = await ownerQueries.createContextFact({
      callerUserId: OWNER,
      subject: { kind: "household", householdId: household.id },
      category: "composition",
      content: "The household keeps a shared calendar.",
    });
    expect(created.result).toMatchObject({
      subject: { kind: "household", householdId: household.id },
      category: "composition",
      visibility: "household",
    });
    expect(created.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OTHER_OWNER },
      { kind: "household-collection", collection: "context-facts", householdId: household.id },
    ]);

    const memberCreated = await memberQueries.createContextFact({
      callerUserId: OTHER_OWNER,
      subject: { kind: "household", householdId: household.id },
      category: "interest",
      content: "The household enjoys trail running.",
    });
    expect(memberCreated.result).toMatchObject({
      subject: { kind: "household", householdId: household.id },
      category: "interest",
      content: "The household enjoys trail running.",
      visibility: "household",
    });
    await expect(ownerQueries.listContextFacts({ callerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.result.id }),
        expect.objectContaining({ id: memberCreated.result.id }),
      ]),
    );

    const updated = await memberQueries.updateContextFact({
      callerUserId: OTHER_OWNER,
      contextFactId: created.result.id,
      category: "composition",
      content: "The household uses one shared calendar.",
      sensitivity: "sensitive",
      expectedUpdatedAt: created.result.updatedAt,
    });
    expect(updated.result).toMatchObject({
      id: created.result.id,
      subject: { kind: "household", householdId: household.id },
      category: "composition",
      content: "The household uses one shared calendar.",
      sensitivity: "sensitive",
      lifecycle: "active",
      visibility: "household",
    });
    expect(store.records.get(created.result.id)).toMatchObject({
      creatorUserId: OWNER,
      lastActorUserId: OTHER_OWNER,
      category: "composition",
      content: "The household uses one shared calendar.",
      sensitivity: "sensitive",
    });
    expect(updated.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OTHER_OWNER },
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
      { kind: "household-collection", collection: "context-facts", householdId: household.id },
    ]);

    await expect(
      ownerQueries.getContextFact({ callerUserId: OWNER, contextFactId: created.result.id }),
    ).resolves.toMatchObject({
      content: "The household uses one shared calendar.",
      sensitivity: "sensitive",
    });

    const archived = await memberQueries.archiveContextFact({
      callerUserId: OTHER_OWNER,
      contextFactId: created.result.id,
      expectedUpdatedAt: updated.result.updatedAt,
    });
    expect(archived.result).toMatchObject({
      id: created.result.id,
      lifecycle: "archived",
      subject: { kind: "household", householdId: household.id },
      visibility: "household",
    });
    await expect(ownerQueries.listContextFacts({ callerUserId: OWNER })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.result.id })]),
    );
    await expect(
      ownerQueries.listContextFacts({ callerUserId: OWNER, includeArchived: true }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.result.id, lifecycle: "archived" }),
        expect.objectContaining({ id: memberCreated.result.id, lifecycle: "active" }),
      ]),
    );

    await expect(store.listAuditLogEntries({ ownerUserId: OTHER_OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "context_fact.update",
          entityId: created.result.id,
          metadataJson: expect.objectContaining({ actorUserId: OTHER_OWNER }),
        }),
        expect.objectContaining({
          action: "context_fact.archive",
          entityId: created.result.id,
          metadataJson: expect.objectContaining({ actorUserId: OTHER_OWNER }),
        }),
      ]),
    );
  });

  it("revokes household reads and mutations across outsiders, another household, and removed members", async () => {
    const householdStore = createInMemoryHouseholdStore();
    const householdLifecycle = createHouseholdLifecycle(householdStore);
    const first = await householdLifecycle.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await householdLifecycle.inviteMember({
      ownerUserId: OWNER,
      householdId: first.household.id,
      invitedUserId: OTHER_OWNER,
    });
    await householdLifecycle.acceptInvite({
      householdId: first.household.id,
      userId: OTHER_OWNER,
    });
    const second = await householdLifecycle.createHousehold({
      ownerUserId: SECOND_HOUSEHOLD_OWNER,
      name: "Second home",
    });

    const store = createInMemoryContextFactStore([], { householdAccess: householdStore });
    const queriesFor = (userId: string) =>
      createContextFactQueries(store, {
        householdAccess: householdStore,
        // The one source record this case proposes from is visible to the first
        // household — the point here is membership revocation, not evidence.
        sourceRecords: {
          getSourceRecordById: async () => ({
            scope: "household",
            householdId: first.household.id,
          }),
        },
        resolveVerifiedCaller: verifiedCallerFor(userId),
      });
    const ownerQueries = queriesFor(OWNER);
    const memberQueries = queriesFor(OTHER_OWNER);
    const secondOwnerQueries = queriesFor(SECOND_HOUSEHOLD_OWNER);
    const outsiderQueries = queriesFor(OUTSIDER);

    const firstFact = await ownerQueries.createContextFact({
      callerUserId: OWNER,
      subject: { kind: "household", householdId: first.household.id },
      category: "composition",
      content: "The household has two adults.",
    });
    const secondFact = await secondOwnerQueries.createContextFact({
      callerUserId: SECOND_HOUSEHOLD_OWNER,
      subject: { kind: "household", householdId: second.household.id },
      category: "composition",
      content: "The second household has a shared garden.",
    });
    await memberQueries.createSelfContextFact({
      callerUserId: OTHER_OWNER,
      category: "work",
      content: "I keep private work context.",
    });
    const householdSuggestion = await memberQueries.createSuggestedContextFact({
      callerUserId: OTHER_OWNER,
      subject: { kind: "household", householdId: first.household.id },
      category: "composition",
      content: "The household may add a shared garden next year.",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: "source-household" },
      suggestionEvidence: "The household discussed adding a shared garden next year.",
    });
    expect(householdSuggestion.result.fact).toMatchObject({
      subject: { kind: "household", householdId: first.household.id },
      lifecycle: "suggested",
    });

    await expect(
      memberQueries.getContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: secondFact.result.id,
      }),
    ).resolves.toBeNull();
    await expect(outsiderQueries.listContextFacts({ callerUserId: OUTSIDER })).resolves.toEqual([]);
    await expect(
      outsiderQueries.updateContextFact({
        callerUserId: OUTSIDER,
        contextFactId: firstFact.result.id,
        category: "composition",
        content: "An outsider must not mutate this household.",
        sensitivity: "normal",
      }),
    ).rejects.toThrow("no longer available");

    // An active member's orientation carries their own Self Context and the
    // household's shared context — and neither the pending household suggestion
    // nor the other household's fact (#382).
    const memberOrientation = await memberQueries.getOrientationContext({
      callerUserId: OTHER_OWNER,
    });
    expect([...memberOrientation.context.facts.map((fact) => fact.subject.kind)].sort()).toEqual([
      "household",
      "self",
    ]);
    expect([...memberOrientation.context.facts.map((fact) => fact.content)].sort()).toEqual([
      "I keep private work context.",
      "The household has two adults.",
    ]);

    await removeHouseholdMember(householdStore, first.household.id, OTHER_OWNER);

    await expect(memberQueries.listContextFacts({ callerUserId: OTHER_OWNER })).resolves.toEqual([
      expect.objectContaining({ content: "I keep private work context." }),
    ]);
    const removedMemberOrientation = await memberQueries.getOrientationContext({
      callerUserId: OTHER_OWNER,
    });
    expect(removedMemberOrientation.context.facts.map((fact) => fact.subject.kind)).toEqual([
      "self",
    ]);
    await expect(
      memberQueries.getContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: firstFact.result.id,
      }),
    ).resolves.toBeNull();
    await expect(
      memberQueries.updateContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: firstFact.result.id,
        category: "composition",
        content: "A removed member must not mutate this household.",
        sensitivity: "normal",
      }),
    ).rejects.toThrow("no longer available");
    await expect(
      memberQueries.archiveContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: firstFact.result.id,
      }),
    ).rejects.toThrow("no longer available");
    await expect(
      memberQueries.createContextFact({
        callerUserId: OTHER_OWNER,
        subject: { kind: "household", householdId: first.household.id },
        category: "other",
        content: "A removed member must not create this household fact.",
      }),
    ).rejects.toThrow("Active household membership is required for Household Context.");
    await expect(
      memberQueries.createSuggestedContextFact({
        callerUserId: OTHER_OWNER,
        subject: { kind: "household", householdId: first.household.id },
        category: "composition",
        content: "A removed member must not suggest this household fact.",
        // Grounded, so the refusal under test is the membership one rather than
        // the schema's — a removed member is refused for standing, and never
        // told anything about the evidence they cited.
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: "source-household" },
        suggestionEvidence: "A removed member must not suggest this household fact.",
      }),
    ).rejects.toThrow("Active household membership is required for Household Context.");

    await expect(
      ownerQueries.getContextFact({ callerUserId: OWNER, contextFactId: firstFact.result.id }),
    ).resolves.toMatchObject({ content: "The household has two adults." });
    await expect(
      secondOwnerQueries.listContextFacts({ callerUserId: SECOND_HOUSEHOLD_OWNER }),
    ).resolves.toEqual([expect.objectContaining({ id: secondFact.result.id })]);
  });

  it("fails closed when a caller tries to create Household Context without active membership", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      householdAccess: createInMemoryHouseholdStore(),
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(
      queries.createContextFact({
        callerUserId: OWNER,
        subject: { kind: "household", householdId: "household-not-mine" },
        category: "other",
        content: "This must not be persisted.",
      }),
    ).rejects.toThrow("Active household membership is required for Household Context.");
    expect(store.records.size).toBe(0);
  });

  it("fails closed when the shared seam has no authenticated caller resolver", async () => {
    const queries = createContextFactQueries(createInMemoryContextFactStore());

    await expect(
      queries.createSelfContextFact({
        callerUserId: OWNER,
        category: "work",
        content: "This must not be accepted without verification.",
      }),
    ).rejects.toThrow("A verified caller is required.");
  });

  it("fails closed when a household store scope has no active-membership adapter", async () => {
    const householdFact = contextFactFixture({
      subject: { kind: "household", householdId: "household-1" },
    });
    const store = createInMemoryContextFactStore([householdFact]);
    const scope = {
      householdIds: ["household-1"],
      activeHouseholdMemberUserId: OWNER,
    };

    await expect(
      store.getContextFact({ contextFactId: householdFact.id, ...scope }),
    ).resolves.toBeNull();
    await expect(store.listContextFacts(scope)).resolves.toEqual([]);
    await expect(
      store.createContextFact({
        ...householdFact,
        id: "00000000-0000-4000-8000-000000000002",
        activeHouseholdMemberUserId: OWNER,
      }),
    ).rejects.toThrow("Active household membership is required for Household Context.");
  });

  it("uses the same UUID and duplicate-write policy for in-memory persistence", async () => {
    const store = createInMemoryContextFactStore();
    const validId = "00000000-0000-4000-8000-000000000001";
    const fact = contextFactFixture({ id: validId });

    await expect(store.createContextFact(fact)).resolves.toMatchObject({ id: validId });
    await expect(store.createContextFact(fact)).rejects.toThrow("Context Fact already exists.");
    await expect(store.createContextFact({ ...fact, id: "not-a-uuid" })).rejects.toThrow(
      "Context Fact id must be a UUID.",
    );
  });

  it("treats normalized exact retries as idempotent and blocks likely current-value conflicts", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    const created = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I work at Acme.",
    });
    const duplicate = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "  I WORK at Acme! ",
    });

    expect(duplicate).toMatchObject({
      decision: "existing",
      result: { id: created.result.id, content: "I work at Acme." },
      affectedScopes: [],
    });
    expect(store.records.size).toBe(1);

    await expect(
      queries.createSelfContextFact({
        callerUserId: OWNER,
        category: "work",
        content: "I work at Northstar.",
      }),
    ).rejects.toThrow("Edit the existing fact instead");
    expect(store.records.size).toBe(1);
  });

  it("reuses an exact equivalent across provenance without replacing its evidence", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const originalProvenance = {
      channel: "onboarding" as const,
      origin: "direct" as const,
      sourceRecordId: null,
    };
    const created = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a software consultancy.",
      provenance: originalProvenance,
    });

    const duplicate = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a software consultancy.",
      provenance: {
        channel: "capture",
        origin: "direct",
        sourceRecordId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(duplicate).toMatchObject({
      decision: "existing",
      result: {
        id: created.result.id,
        provenance: { channel: "onboarding", origin: "direct" },
      },
      affectedScopes: [],
    });
    expect(store.records.size).toBe(1);
  });

  it("archives out of active reads, restores through an expected inverse, and rejects stale undo", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const created = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "interest",
      content: "I like trail running.",
    });

    const archived = await queries.archiveSelfContextFact({
      callerUserId: OWNER,
      contextFactId: created.result.id,
      expectedUpdatedAt: created.result.updatedAt,
    });
    expect(archived).toMatchObject({ decision: "archived", result: { lifecycle: "archived" } });
    expect(archived.result.archivedAt).toBeInstanceOf(Date);
    expect(archived.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
    ]);
    await expect(
      queries.archiveSelfContextFact({
        callerUserId: OWNER,
        contextFactId: created.result.id,
        expectedUpdatedAt: created.result.updatedAt,
      }),
    ).resolves.toMatchObject({ decision: "archived", result: { lifecycle: "archived" } });
    await expect(queries.listContextFacts({ callerUserId: OWNER })).resolves.toEqual([]);
    await expect(
      queries.listSelfContextFacts({ callerUserId: OWNER, includeArchived: true }),
    ).resolves.toEqual([expect.objectContaining({ lifecycle: "archived" })]);

    const restored = await queries.restoreSelfContextFact({
      callerUserId: OWNER,
      contextFactId: created.result.id,
      expectedArchivedAt: archived.result.archivedAt as Date,
    });
    expect(restored).toMatchObject({ decision: "restored", result: { lifecycle: "active" } });
    expect(restored.affectedScopes).toEqual(archived.affectedScopes);
    await expect(queries.listContextFacts({ callerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ id: created.result.id }),
    ]);

    await expect(
      queries.restoreSelfContextFact({
        callerUserId: OWNER,
        contextFactId: created.result.id,
        expectedArchivedAt: archived.result.archivedAt as Date,
      }),
    ).rejects.toThrow("archive changed elsewhere");
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "context_fact.archive" }),
        expect.objectContaining({ action: "context_fact.restore" }),
      ]),
    );

    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });
    await expect(
      otherQueries.archiveSelfContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: created.result.id,
        expectedUpdatedAt: restored.result.updatedAt,
      }),
    ).rejects.toThrow("no longer available");
    await expect(
      otherQueries.restoreSelfContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: created.result.id,
      }),
    ).rejects.toThrow("no longer available");
  });

  it("does not restore an archived fact into a duplicate or conflicting active slot", async () => {
    const archivedId = "00000000-0000-4000-8000-000000000081";
    const activeId = "00000000-0000-4000-8000-000000000082";
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: archivedId,
        lifecycle: "archived",
        archivedAt: new Date("2026-08-02T12:01:00.000Z"),
        content: "I work at Acme.",
      }),
      contextFactFixture({
        id: activeId,
        content: "I work at Acme.",
      }),
    ]);
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(
      queries.restoreSelfContextFact({ callerUserId: OWNER, contextFactId: archivedId }),
    ).resolves.toMatchObject({
      decision: "existing",
      result: { id: activeId, lifecycle: "active" },
      affectedScopes: [],
    });

    const conflictStore = createInMemoryContextFactStore([
      contextFactFixture({
        id: archivedId,
        lifecycle: "archived",
        archivedAt: new Date("2026-08-02T12:01:00.000Z"),
        content: "I work at Acme.",
      }),
      contextFactFixture({ id: activeId, content: "I work at Northstar." }),
    ]);
    const conflictQueries = createContextFactQueries(conflictStore, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    await expect(
      conflictQueries.restoreSelfContextFact({ callerUserId: OWNER, contextFactId: archivedId }),
    ).rejects.toThrow("conflicts with another active fact");
  });

  it("permanently deletes Self Context content and keeps only a non-content tombstone", async () => {
    const suggestedId = "00000000-0000-4000-8000-000000000077";
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: suggestedId,
        lifecycle: "suggested",
        suggestionEvidence: "The user's private evidence must be removed.",
      }),
    ]);
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    const deleted = await queries.deleteSelfContextFact({
      callerUserId: OWNER,
      contextFactId: suggestedId,
    });
    expect(deleted.result).toEqual({ deletedContextFactId: suggestedId });
    expect(store.records.has(suggestedId)).toBe(false);
    const tombstone = (await store.listAuditLogEntries({ ownerUserId: OWNER })).at(-1);
    expect(tombstone).toMatchObject({ action: "context_fact.delete", entityId: suggestedId });
    expect(tombstone?.metadataJson).toMatchObject({
      previousLifecycle: "suggested",
      suggestionEvidenceRemoved: true,
    });
    expect(tombstone?.metadataJson).not.toHaveProperty("content");
    expect(tombstone?.metadataJson).not.toHaveProperty("suggestionEvidence");

    await expect(
      queries.deleteSelfContextFact({ callerUserId: OWNER, contextFactId: suggestedId }),
    ).resolves.toMatchObject({
      result: { deletedContextFactId: suggestedId },
      affectedScopes: [],
    });

    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });
    await expect(
      otherQueries.deleteSelfContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: suggestedId,
      }),
    ).rejects.toThrow("no longer available");
  });
});
