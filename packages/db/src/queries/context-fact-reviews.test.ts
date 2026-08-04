import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contextFactFixture } from "./context-fact-fixtures";
import { createContextFactQueries, createInMemoryContextFactStore } from "./context-facts";
import type { ContextFactStore } from "./context-facts/types";

const OWNER = "user-owner";
const OTHER_OWNER = "user-other";
const verifiedCallerFor = (userId: string) => async () => userId;

describe("Suggested Context Fact review contract", () => {
  it("returns one authoritative review row when identical suggestions race", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const input = {
      callerUserId: OWNER,
      category: "work" as const,
      content: "I run a software consultancy.",
      sensitivity: "normal" as const,
      provenance: {
        channel: "ambient" as const,
        origin: "ambient" as const,
        sourceRecordId: "source-1",
      },
      suggestionEvidence: "I run a software consultancy.",
    };

    const results = await Promise.all([
      queries.createSuggestedSelfContextFact(input),
      queries.createSuggestedSelfContextFact(input),
    ]);

    expect(results.map((result) => result.decision).sort()).toEqual(["created", "existing"]);
    expect(
      [...store.records.values()].filter((fact) => fact.lifecycle === "suggested"),
    ).toHaveLength(1);
  });

  it("creates a bounded owner-scoped suggestion and accepts it as authoritative context", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    const suggested = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I run a software consultancy.",
      sensitivity: "sensitive",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: "source-1" },
      suggestionEvidence: "I run a software consultancy.",
    });

    expect(suggested.result).toMatchObject({
      fact: {
        subject: { kind: "self", userId: OWNER },
        category: "work",
        content: "I run a software consultancy.",
        lifecycle: "suggested",
        sensitivity: "sensitive",
        suggestionEvidence: "I run a software consultancy.",
      },
      evidence: "I run a software consultancy.",
      activeMatch: null,
    });
    expect(suggested.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "orientation", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
    ]);

    await expect(queries.listSuggestedContextFactReviews({ callerUserId: OWNER })).resolves.toEqual(
      [
        expect.objectContaining({
          fact: expect.objectContaining({ id: suggested.result.fact.id }),
        }),
      ],
    );

    const accepted = await queries.acceptSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggested.result.fact.id,
      expectedUpdatedAt: suggested.result.fact.updatedAt,
    });

    expect(accepted).toMatchObject({
      decision: "accepted",
      result: {
        id: suggested.result.fact.id,
        content: "I run a software consultancy.",
        lifecycle: "active",
        sensitivity: "sensitive",
      },
    });
    await expect(queries.listSuggestedContextFactReviews({ callerUserId: OWNER })).resolves.toEqual(
      [],
    );
    await expect(queries.listEligibleContextFacts({ callerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({ id: suggested.result.fact.id, sensitivity: "sensitive" }),
    ]);
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "context_fact.suggest" }),
        expect.objectContaining({ action: "context_fact.review.accept" }),
      ]),
    );
  });

  it("edit-and-accepts reviewed wording without downgrading sensitivity", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const suggested = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "preference",
      content: "I like short answers.",
      sensitivity: "restricted",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I prefer concise answers when I am working.",
    });

    await expect(
      queries.acceptSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: suggested.result.fact.id,
        edit: { content: "This would downgrade the reviewed sensitivity.", sensitivity: "normal" },
      }),
    ).rejects.toThrow("cannot be downgraded");

    const accepted = await queries.acceptSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggested.result.fact.id,
      edit: {
        category: "preference",
        content: "I prefer concise answers.",
        sensitivity: "restricted",
      },
    });

    expect(accepted).toMatchObject({
      decision: "accepted",
      result: {
        content: "I prefer concise answers.",
        category: "preference",
        sensitivity: "restricted",
        lifecycle: "active",
      },
    });
  });

  it("dismisses, suppresses re-enqueue, and rejects stale dismissal intent", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const input = {
      callerUserId: OWNER,
      category: "location" as const,
      content: "I am based in Chicago.",
      sensitivity: "normal" as const,
      provenance: {
        channel: "ambient" as const,
        origin: "ambient" as const,
        sourceRecordId: "source-2",
      },
      suggestionEvidence: "I am based in Chicago.",
    };
    const suggested = await queries.createSuggestedSelfContextFact(input);

    await expect(
      queries.dismissSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: suggested.result.fact.id,
        expectedUpdatedAt: new Date("2026-08-02T11:59:00.000Z"),
      }),
    ).rejects.toThrow("changed elsewhere");
    await expect(
      queries.listSuggestedContextFactReviews({ callerUserId: OWNER }),
    ).resolves.toHaveLength(1);

    const dismissed = await queries.dismissSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggested.result.fact.id,
      expectedUpdatedAt: suggested.result.fact.updatedAt,
    });

    expect(dismissed.result).toEqual({ dismissedContextFactId: suggested.result.fact.id });
    expect(store.records.has(suggested.result.fact.id)).toBe(false);
    await expect(queries.listSuggestedContextFactReviews({ callerUserId: OWNER })).resolves.toEqual(
      [],
    );
    await expect(queries.createSuggestedSelfContextFact(input)).rejects.toThrow(
      "already dismissed",
    );
    const dismissal = (await store.listAuditLogEntries({ ownerUserId: OWNER })).find(
      (entry) => entry.action === "context_fact.review.dismiss",
    );
    expect(dismissal?.metadataJson).toMatchObject({
      previousLifecycle: "suggested",
      suppressionKey: expect.any(String),
      suggestionEvidenceRemoved: true,
    });
    expect(dismissal?.metadataJson).not.toHaveProperty("content");
    expect(dismissal?.metadataJson).not.toHaveProperty("suggestionEvidence");
  });

  it("keeps a dismissal binding when the same statement arrives from a later session", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const suggestion = (sourceRecordId: string) => ({
      callerUserId: OWNER,
      category: "interest" as const,
      content: "I follow trail running.",
      sensitivity: "normal" as const,
      provenance: { channel: "import" as const, origin: "import" as const, sourceRecordId },
      suggestionEvidence: 'From your ChatGPT memory: "I follow trail running."',
    });

    const suggested = await queries.createSuggestedSelfContextFact(suggestion("import-1"));
    await queries.dismissSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggested.result.fact.id,
    });

    // A second import is a new session with a new source reference. The owner already
    // judged this statement, so the dismissal has to outlive the session that raised it.
    await expect(queries.createSuggestedSelfContextFact(suggestion("import-2"))).rejects.toThrow(
      "already dismissed",
    );
  });

  it("still honours a dismissal recorded under the pre-#352 key shape", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const provenance = {
      channel: "ambient" as const,
      origin: "ambient" as const,
      sourceRecordId: null,
    };
    const suggestion = {
      callerUserId: OWNER,
      category: "interest" as const,
      content: "I follow trail running.",
      sensitivity: "normal" as const,
      provenance,
      suggestionEvidence: "I follow trail running.",
    };
    // The shape the key had before `sourceRecordId` was dropped from the hash. A
    // stored dismissal must keep binding, or deploying the fix would resurrect
    // every suggestion an owner had already turned down.
    await store.createAuditLogEntry({
      ownerUserId: OWNER,
      action: "context_fact.review.dismiss",
      entityType: "context_fact",
      entityId: "00000000-0000-4000-8000-0000000000aa",
      metadataJson: {
        suppressionKey: createHash("sha256")
          .update(
            JSON.stringify({
              subject: { kind: "self", userId: OWNER },
              category: "interest",
              content: "i follow trail running",
              sensitivity: "normal",
              provenance,
            }),
          )
          .digest("hex"),
      },
    });

    await expect(queries.createSuggestedSelfContextFact(suggestion)).rejects.toThrow(
      "already dismissed",
    );
  });

  it("never lets a concurrent dismissal delete an accepted active truth", async () => {
    const baseStore = createInMemoryContextFactStore();
    let queries: ReturnType<typeof createContextFactQueries>;
    let accepted = false;
    const raceStore: ContextFactStore = {
      ...baseStore,
      async deleteContextFact(input) {
        if (!accepted) {
          accepted = true;
          await queries.acceptSuggestedContextFact({
            callerUserId: OWNER,
            contextFactId: input.contextFactId,
            expectedUpdatedAt: input.expectedUpdatedAt,
          });
        }
        return baseStore.deleteContextFact(input);
      },
    };
    queries = createContextFactQueries(raceStore, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const suggested = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "interest",
      content: "I like trail running.",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I like trail running.",
    });

    await expect(
      queries.dismissSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: suggested.result.fact.id,
        expectedUpdatedAt: suggested.result.fact.updatedAt,
      }),
    ).rejects.toThrow("changed elsewhere");
    expect(baseStore.records.get(suggested.result.fact.id)?.lifecycle).toBe("active");
    expect(
      (await baseStore.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action),
    ).toContain("context_fact.review.accept");
  });

  it("hides legacy ungrounded suggestions and refuses direct acceptance", async () => {
    const ungroundedId = "00000000-0000-4000-8000-000000000077";
    const store = createInMemoryContextFactStore([
      contextFactFixture({
        id: ungroundedId,
        lifecycle: "suggested",
        suggestionEvidence: null,
      }),
    ]);
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });

    await expect(queries.listSuggestedContextFactReviews({ callerUserId: OWNER })).resolves.toEqual(
      [],
    );
    await expect(
      queries.getSuggestedContextFactReview({ callerUserId: OWNER, contextFactId: ungroundedId }),
    ).resolves.toBeNull();
    await expect(
      queries.acceptSuggestedContextFact({ callerUserId: OWNER, contextFactId: ungroundedId }),
    ).rejects.toThrow("no grounded evidence");
  });

  it("exposes active duplicates and conflicts for focused correction instead of creating a second truth", async () => {
    const store = createInMemoryContextFactStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const active = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I work at Acme.",
    });
    const duplicate = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: " I WORK at Acme! ",
      sensitivity: "normal",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I work at Acme.",
    });
    const conflict = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I work at Northstar.",
      sensitivity: "normal",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I work at Northstar.",
    });

    expect(duplicate.result.activeMatch).toMatchObject({
      kind: "duplicate",
      fact: { id: active.result.id, content: "I work at Acme." },
    });
    expect(conflict.result.activeMatch).toMatchObject({
      kind: "conflict",
      fact: { id: active.result.id, content: "I work at Acme." },
    });
    await expect(
      queries.acceptSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: conflict.result.fact.id,
      }),
    ).rejects.toMatchObject({ existingFactId: active.result.id });
    expect([...store.records.values()].filter((fact) => fact.lifecycle === "active")).toHaveLength(
      1,
    );
  });

  it("reconciles a concurrent active conflict back to review with a focused correction", async () => {
    const baseStore = createInMemoryContextFactStore();
    let injected = false;
    const raceFactId = "00000000-0000-4000-8000-000000000078";
    const store: ContextFactStore = {
      ...baseStore,
      async updateContextFact(input) {
        if (!injected && input.patch.lifecycle === "active") {
          injected = true;
          await baseStore.createContextFact(
            contextFactFixture({
              id: raceFactId,
              category: "work",
              content: "I work at Northstar.",
            }),
          );
        }
        return baseStore.updateContextFact(input);
      },
    };
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const suggested = await queries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I work at Acme.",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I work at Acme.",
    });

    await expect(
      queries.acceptSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: suggested.result.fact.id,
      }),
    ).rejects.toMatchObject({ existingFactId: raceFactId });
    expect(baseStore.records.get(suggested.result.fact.id)?.lifecycle).toBe("suggested");
    expect(
      [...baseStore.records.values()].filter((fact) => fact.lifecycle === "active"),
    ).toHaveLength(1);
  });

  it("keeps suggestions and review mutations isolated between owners", async () => {
    const store = createInMemoryContextFactStore();
    const ownerQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OWNER),
    });
    const otherQueries = createContextFactQueries(store, {
      resolveVerifiedCaller: verifiedCallerFor(OTHER_OWNER),
    });
    const suggested = await ownerQueries.createSuggestedSelfContextFact({
      callerUserId: OWNER,
      category: "interest",
      content: "I like trail running.",
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: "I like trail running.",
    });

    await expect(
      otherQueries.listSuggestedContextFactReviews({ callerUserId: OTHER_OWNER }),
    ).resolves.toEqual([]);
    await expect(
      otherQueries.acceptSuggestedContextFact({
        callerUserId: OTHER_OWNER,
        contextFactId: suggested.result.fact.id,
      }),
    ).rejects.toThrow("no longer available");
    await expect(
      ownerQueries.listSuggestedContextFactReviews({ callerUserId: OWNER }),
    ).resolves.toEqual([
      expect.objectContaining({ fact: expect.objectContaining({ id: suggested.result.fact.id }) }),
    ]);
  });
});
