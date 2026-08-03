import { createFakeContextFactExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createContextFactQueries } from "../context-facts/queries";
import { createInMemoryContextFactExtractionJobStore } from "./in-memory-store";
import {
  createContextFactExtractionProcessor,
  DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS,
} from "./processor";

const OWNER = "user-owner";
const OTHER_OWNER = "user-other";
const NOW = new Date("2026-08-03T12:00:00.000Z");

const candidate = {
  category: "work" as const,
  content: "Works as a product designer.",
  evidence: "I work as a product designer",
};

async function enqueue(
  processor: ReturnType<typeof createContextFactExtractionProcessor>,
  ownerUserId = OWNER,
  idempotencyKey = `eve:turn:${ownerUserId}`,
  message = "I work as a product designer. My private note must not become evidence.",
) {
  return processor.enqueueContextFactExtractionJob({
    ownerUserId,
    message,
    idempotencyKey,
    runAfter: NOW,
  });
}

describe("Context Fact extraction processor", () => {
  it("creates one owner-scoped review suggestion with minimal ambient provenance", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const { job } = await enqueue(processor);

    const result = await processor.processContextFactExtractionJob({
      jobId: job.id,
      now: NOW,
    });

    expect(result).toMatchObject({
      outcome: "completed",
      createdSuggestionCount: 1,
      invalidCandidateCount: 0,
    });
    expect(result.job.message).toBeNull();
    const facts = await store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      subject: { kind: "self", userId: OWNER },
      provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
      suggestionEvidence: candidate.evidence,
    });
    expect(facts[0]?.suggestionEvidence).not.toContain("private note");
    expect(facts[0]?.provenance).not.toHaveProperty("message");
    await expect(
      createContextFactQueries(store, {
        resolveVerifiedCaller: async () => OWNER,
      }).getOrientationContext({
        callerUserId: OWNER,
      }),
    ).resolves.toMatchObject({ context: { facts: [] } });
  });

  it("keeps owner scope isolated and never loads another owner's facts", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const ownerJob = await enqueue(processor, OWNER, "eve:owner:turn");
    const otherJob = await enqueue(processor, OTHER_OWNER, "eve:other:turn");

    await processor.processContextFactExtractionJob({ jobId: ownerJob.job.id, now: NOW });

    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toHaveLength(1);
    await expect(
      store.listContextFacts({ subjectUserId: OTHER_OWNER, lifecycle: "suggested" }),
    ).resolves.toEqual([]);
    expect((await store.getContextFactExtractionJob(otherJob.job.id))?.status).toBe("pending");
  });

  it("makes replay idempotent at both the job and candidate seams", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const first = await enqueue(processor);
    const replay = await enqueue(processor);
    expect(replay).toMatchObject({ created: false, job: { id: first.job.id } });

    await processor.processContextFactExtractionJob({ jobId: first.job.id, now: NOW });
    const secondRun = await processor.processContextFactExtractionJob({
      jobId: first.job.id,
      now: new Date(NOW.getTime() + 1),
    });

    expect(secondRun.outcome).toBe("not_claimable");
    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toHaveLength(1);
  });

  it("rejects an idempotency-key replay across owners", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store);
    await enqueue(processor, OWNER, "shared-idempotency-key");

    await expect(enqueue(processor, OTHER_OWNER, "shared-idempotency-key")).rejects.toThrow(
      "belongs to another owner",
    );
  });

  it("dedupes normalized candidate replays through the shared review seam", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const firstProcessor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const first = await enqueue(firstProcessor, OWNER, "eve:normalized:first");
    await firstProcessor.processContextFactExtractionJob({ jobId: first.job.id, now: NOW });

    const secondProcessor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([
        {
          ...candidate,
          content: "WORKS AS A PRODUCT DESIGNER!",
        },
      ]),
    });
    const second = await enqueue(secondProcessor, OWNER, "eve:normalized:second");
    const result = await secondProcessor.processContextFactExtractionJob({
      jobId: second.job.id,
      now: new Date(NOW.getTime() + 1),
    });

    expect(result).toMatchObject({
      outcome: "completed",
      createdSuggestionCount: 0,
      existingSuggestionCount: 1,
    });
    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toHaveLength(1);
  });

  it("retries adapter failures and dead-letters after the bounded attempt count", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      maxAttempts: 2,
      extractionAdapter: {
        kind: "fake",
        async extractCandidates() {
          throw new Error("provider unavailable");
        },
      },
    });
    const { job } = await enqueue(processor);

    const first = await processor.processContextFactExtractionJob({ jobId: job.id, now: NOW });
    expect(first).toMatchObject({ outcome: "failed", error: "provider unavailable" });
    expect(first.job.status).toBe("failed");
    expect(first.job.runAfter.getTime()).toBe(
      NOW.getTime() + DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS,
    );

    const second = await processor.processContextFactExtractionJob({
      jobId: job.id,
      now: new Date(NOW.getTime() + DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS),
    });
    expect(second).toMatchObject({ outcome: "dead_lettered", error: "provider unavailable" });
    await expect(store.listContextFactExtractionJobs()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "dead_lettered", attempts: 2 })]),
    );
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "context_fact_extraction_job.failed" }),
        expect.objectContaining({ action: "context_fact_extraction_job.dead_lettered" }),
      ]),
    );
  });

  it("does not block completion when a candidate is suppressed by review policy", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const first = await enqueue(processor, OWNER, "eve:first");
    await processor.processContextFactExtractionJob({ jobId: first.job.id, now: NOW });
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: async () => OWNER,
    });
    const [suggestion] = await queries.listSuggestedContextFactReviews({ callerUserId: OWNER });
    if (!suggestion) throw new Error("Expected a suggestion to dismiss.");
    await queries.dismissSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggestion.fact.id,
      expectedUpdatedAt: suggestion.fact.updatedAt,
    });

    const replay = await enqueue(processor, OWNER, "eve:second");
    const result = await processor.processContextFactExtractionJob({
      jobId: replay.job.id,
      now: new Date(NOW.getTime() + 2),
    });
    expect(result).toMatchObject({ outcome: "completed", suppressedCandidateCount: 1 });
    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toEqual([]);
  });

  it("enforces the per-owner pending suggestion cap without crossing owner scope", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: async () => OWNER,
    });
    for (let index = 0; index < 20; index += 1) {
      await queries.createSuggestedSelfContextFact({
        callerUserId: OWNER,
        category: "interest",
        content: `Enjoys hobby ${index}.`,
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
        suggestionEvidence: `I enjoy hobby ${index}.`,
      });
    }
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const { job } = await enqueue(processor, OWNER, "eve:cap");

    const result = await processor.processContextFactExtractionJob({ jobId: job.id, now: NOW });
    expect(result).toMatchObject({ outcome: "completed", suppressedCandidateCount: 1 });
    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toHaveLength(20);
  });

  it("records active duplicate/conflict linkage through the shared review seam", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const queries = createContextFactQueries(store, {
      resolveVerifiedCaller: async () => OWNER,
    });
    const active = await queries.createSelfContextFact({
      callerUserId: OWNER,
      category: "work",
      content: "I work at Acme.",
    });
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([
        {
          category: "work",
          content: "I work at Northstar.",
          evidence: "I work at Northstar",
        },
      ]),
    });
    const { job } = await enqueue(processor, OWNER, "eve:conflict", "I work at Northstar");

    await processor.processContextFactExtractionJob({ jobId: job.id, now: NOW });
    const suggestion = (
      await store.listContextFacts({
        subjectUserId: OWNER,
        lifecycle: "suggested",
      })
    )[0];
    expect(suggestion).toBeDefined();
    expect(
      (await store.listAuditLogEntries({ ownerUserId: OWNER })).find(
        (entry) => entry.action === "context_fact.suggest",
      )?.metadataJson,
    ).toMatchObject({ activeMatchId: active.result.id, activeMatchKind: "conflict" });
  });

  it("exposes a safe no-op for a job that is not due or already claimed", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const { job } = await enqueue(processor);

    const result = await processor.processContextFactExtractionJob({
      jobId: job.id,
      now: new Date(NOW.getTime() - 1),
    });
    expect(result.outcome).toBe("not_claimable");
  });

  it("claims the oldest due job through the in-memory backfill seam", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store);
    const later = await enqueue(processor, OWNER, "eve:later");
    const earlier = await enqueue(processor, OWNER, "eve:earlier");
    await store.updateContextFactExtractionJob({
      jobId: later.job.id,
      runAfter: new Date(NOW.getTime() + 1),
    });

    const claimed = await processor.claimNextContextFactExtractionJob({ now: NOW });

    expect(claimed).toMatchObject({ id: earlier.job.id, status: "running" });
    expect(claimed?.claimToken).toEqual(expect.any(String));
  });

  it("reclaims an expired lease and fences the stale worker's terminal write", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const processor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([candidate]),
    });
    const { job } = await enqueue(processor, OWNER, "eve:lease");
    const firstClaim = await store.claimContextFactExtractionJob({ jobId: job.id, now: NOW });
    if (!firstClaim?.claimToken) throw new Error("Expected the first worker claim token.");

    const secondClaim = await store.claimContextFactExtractionJob({
      jobId: job.id,
      now: new Date(NOW.getTime() + 11 * 60 * 1000),
    });
    if (!secondClaim?.claimToken) throw new Error("Expected the expired lease to be reclaimed.");
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    const staleWorker = await processor.processContextFactExtractionJob({
      jobId: job.id,
      claim: false,
      claimToken: firstClaim.claimToken,
      now: new Date(NOW.getTime() + 11 * 60 * 1000),
    });
    expect(staleWorker.outcome).toBe("not_claimable");

    const currentWorker = await processor.processContextFactExtractionJob({
      jobId: job.id,
      claim: false,
      claimToken: secondClaim.claimToken,
      now: new Date(NOW.getTime() + 11 * 60 * 1000),
    });
    expect(currentWorker.outcome).toBe("completed");
  });

  it("keeps the pending suggestion cap under concurrent extraction completions", async () => {
    const store = createInMemoryContextFactExtractionJobStore();
    const firstProcessor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([
        { ...candidate, content: "Works as a product designer at Acme." },
      ]),
    });
    const secondProcessor = createContextFactExtractionProcessor(store, {
      extractionAdapter: createFakeContextFactExtractionAdapter([
        { ...candidate, content: "Works as a product designer at Northstar." },
      ]),
    });
    for (let index = 0; index < 19; index += 1) {
      await createContextFactQueries(store, {
        resolveVerifiedCaller: async () => OWNER,
      }).createSuggestedSelfContextFact({
        callerUserId: OWNER,
        category: "interest",
        content: `Enjoys hobby ${index}.`,
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: null },
        suggestionEvidence: `I enjoy hobby ${index}.`,
      });
    }
    const first = await enqueue(
      firstProcessor,
      OWNER,
      "eve:concurrent:first",
      "I work as a product designer at Acme.",
    );
    const second = await enqueue(
      secondProcessor,
      OWNER,
      "eve:concurrent:second",
      "I work as a product designer at Northstar.",
    );

    await Promise.all([
      firstProcessor.processContextFactExtractionJob({ jobId: first.job.id, now: NOW }),
      secondProcessor.processContextFactExtractionJob({
        jobId: second.job.id,
        now: new Date(NOW.getTime() + 1),
      }),
    ]);

    await expect(
      store.listContextFacts({ subjectUserId: OWNER, lifecycle: "suggested" }),
    ).resolves.toHaveLength(20);
  });
});
