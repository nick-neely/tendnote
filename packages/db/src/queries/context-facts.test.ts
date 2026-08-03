import { type ContextFact, type ContextFactProvenance, contextFactSchema } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createContextFactQueries, createInMemoryContextFactStore } from "./context-facts";
import { createInMemoryHouseholdStore } from "./households/in-memory-store";
import { createHouseholdLifecycle } from "./households/lifecycle";

const OWNER = "user-owner";
const OTHER_OWNER = "user-other";
const verifiedCallerFor = (userId: string) => async () => userId;

const directProvenance: ContextFactProvenance = {
  channel: "account",
  origin: "direct",
  sourceRecordId: null,
};

function contextFactFixture(overrides: Partial<ContextFact> = {}): ContextFact {
  const now = new Date("2026-08-02T12:00:00.000Z");
  return contextFactSchema.parse({
    id: "fact-fixture",
    subject: { kind: "self", userId: OWNER },
    category: "background",
    content: "I prefer concise answers.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: directProvenance,
    suggestionEvidence: null,
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
    reviewedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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

  it("lists only active facts for the caller and never crosses Self Context owners", async () => {
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
    });
    await otherQueries.createSelfContextFact({
      callerUserId: OTHER_OWNER,
      category: "interest",
      content: "I collect vinyl records.",
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

  it("supports whole-household Context Facts without exposing a member's private Self Context", async () => {
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

    const store = createInMemoryContextFactStore();
    const createQueriesFor = (userId: string) =>
      createContextFactQueries(store, {
        householdAccess: householdStore,
        resolveVerifiedCaller: verifiedCallerFor(userId),
      });
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

    const membership = await householdStore.getHouseholdMembership({
      householdId: household.id,
      userId: OTHER_OWNER,
    });
    if (!membership) throw new Error("Expected the active household membership fixture.");
    await householdStore.updateHouseholdMembership({
      membershipId: membership.id,
      patch: { status: "removed", removedAt: new Date() },
    });

    await expect(memberQueries.listContextFacts({ callerUserId: OTHER_OWNER })).resolves.toEqual([
      expect.objectContaining({ content: "I have private work context." }),
    ]);
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
