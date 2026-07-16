import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeEmbeddingAdapter } from "./fake-adapter";
import { createHarness, EMBEDDING_CONFIG, OWNER } from "./harness";
import { DEFAULT_EMBEDDING_CONFIG } from "./processor";
import { createSemanticRetrievalQueries } from "./queries";
import type { EmbeddingAdapter } from "./types";

const vectorAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return {
      vector: [1, 0, 0, 0],
      model: input.model,
      version: input.version,
    };
  },
};

const moduleSource = readFileSync(join(import.meta.dirname, "../semantic-retrieval.ts"), "utf8");
const prd = readFileSync(join(import.meta.dirname, "../../../../../docs/prd.md"), "utf8");
const semanticAdr = readFileSync(
  join(
    import.meta.dirname,
    "../../../../../docs/adr/0013-semantic-retrieval-embeds-selected-context.md",
  ),
  "utf8",
);

describe("semantic retrieval hardening", () => {
  it("fails open while embedding work is missing, still processing, or failed", async () => {
    const { store, processor, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
    const missing = await createApprovedMemory({ content: "Mara likes cooking gifts." });
    const pending = await createApprovedMemory({ content: "Mara has career updates." });
    const running = await createApprovedMemory({ content: "Mara shared a stressful week." });
    const failed = await createApprovedMemory({ content: "Mara wants a cookbook." });
    const stale = await createApprovedMemory({ content: "Mara likes ceramic cooking gifts." });

    await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: pending.id,
    });
    const { job: runningJob } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: running.id,
    });
    await store.claimEmbeddingJob({ jobId: runningJob.id, now: new Date() });
    const { job: failedJob } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: failed.id,
    });
    await store.updateEmbeddingJob({
      jobId: failedJob.id,
      status: "failed",
      lastError: "provider unavailable",
      runAfter: new Date(Date.now() + 60_000),
    });
    const { job: staleJob } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: stale.id,
    });
    await processor.processEmbeddingJob({ jobId: staleJob.id });
    await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: stale.id,
      patch: { content: "Mara switched to pottery studio gift ideas." },
    });

    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);
    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 10,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(missing.status).toBe("approved");
    expect(results).toEqual([]);
  });

  it("keeps normal verification on fake vectors without provider credentials", async () => {
    const adapter = createFakeEmbeddingAdapter();
    const embedding = await adapter.embedText({
      text: "Mara likes cooking gifts.",
      model: DEFAULT_EMBEDDING_CONFIG.model,
      version: DEFAULT_EMBEDDING_CONFIG.version,
    });

    expect(DEFAULT_EMBEDDING_CONFIG.model).toBe("fake-semantic-retrieval");
    expect(embedding).toEqual({
      vector: expect.arrayContaining([expect.any(Number)]),
      model: "fake-semantic-retrieval",
      version: "v2",
    });
    expect(embedding.vector).toHaveLength(64);
    expect(moduleSource).toContain("createFakeEmbeddingAdapter()");
    expect(moduleSource).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY/);
    expect(moduleSource).toContain("AI_GATEWAY_API_KEY");
  });

  it("keeps PRD and ADR references aligned around the Phase 1D boundary", () => {
    for (const doc of [prd, semanticAdr]) {
      expect(doc).toContain("Semantic Retrieval");
      expect(doc).toContain("relationship_context_embeddings");
      expect(doc).toContain("search_semantic_context");
      expect(doc).toMatch(/similarity-first|Rank Phase 1D semantic results primarily/i);
      expect(doc).toMatch(/Phase 1E\.25/);
      expect(doc).toMatch(/standalone semantic search page/i);
      expect(doc).toMatch(/normal verification|deterministic fake-vector tests/i);
    }
    expect(prd).toMatch(/must not depend on embeddings/i);
    expect(semanticAdr).toMatch(/should not treat those matches as proactive/i);
  });
});
