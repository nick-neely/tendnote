import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeEmbeddingAdapter } from "./fake-adapter";
import { createInMemoryEmbeddingStore } from "./in-memory-store";
import { createEmbeddingProcessor, DEFAULT_EMBEDDING_CONFIG } from "./processor";
import { createSemanticRetrievalQueries } from "./queries";

describe("Saved Item semantic indexing", () => {
  it("keeps visibility and archive policy inside the production semantic SQL", () => {
    const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
    expect(source).toContain("async searchSavedItemsSemantic(input)");
    expect(source).toContain('recordKind: "saved_item"');
    expect(source).toContain("input.includeArchived");
    expect(source).toContain("si.status = 'active'");
    expect(source).toContain("e.trust_level = 'saved_context'");
  });

  it("embeds a grounded Saved Item in the saved-context trust register", async () => {
    const store = createInMemoryEmbeddingStore();
    const item = await store.createSavedItem({
      ownerUserId: "owner-1",
      kind: "open_question",
      title: "Where should I buy the refrigerator filter?",
      content: null,
      url: null,
      status: "active",
      bringBackAt: null,
      sourceRecordId: "source-1",
      scope: "private",
      householdId: null,
      resolvedAt: null,
      resolutionReason: null,
      createdByUserId: "owner-1",
      lastActorUserId: "owner-1",
    });
    const processor = createEmbeddingProcessor(store, createFakeEmbeddingAdapter());
    const queued = await processor.enqueueEmbeddingJob({
      ownerUserId: item.ownerUserId,
      recordKind: "saved_item",
      recordId: item.id,
    });

    const result = await processor.processEmbeddingJob({ jobId: queued.job.id });

    expect(result).toMatchObject({
      outcome: "completed",
      sourceSavedItem: { id: item.id },
      embedding: {
        recordKind: "saved_item",
        trustLevel: "saved_context",
        embeddedText: "Where should I buy the refrigerator filter?",
      },
    });
  });

  it("retrieves active Saved Items by meaning and requires an explicit archive request", async () => {
    const store = createInMemoryEmbeddingStore();
    const adapter = createFakeEmbeddingAdapter();
    const processor = createEmbeddingProcessor(store, adapter);
    const create = async (status: "active" | "archived") => {
      const item = await store.createSavedItem({
        ownerUserId: "owner-1",
        kind: "note",
        title: `Refrigerator filter ${status}`,
        content: "The replacement is eight inches long",
        url: null,
        status,
        sourceRecordId: `source-${status}`,
      });
      const queued = await processor.enqueueEmbeddingJob({
        ownerUserId: item.ownerUserId,
        recordKind: "saved_item",
        recordId: item.id,
      });
      await processor.processEmbeddingJob({ jobId: queued.job.id });
      return item;
    };
    const active = await create("active");
    const archived = await create("archived");
    const queries = createSemanticRetrievalQueries(store, adapter, DEFAULT_EMBEDDING_CONFIG);

    await expect(
      queries.searchSavedItemsSemantic({ ownerUserId: "owner-1", query: "filter size" }),
    ).resolves.toMatchObject([{ savedItemId: active.id, status: "active" }]);
    await expect(
      queries.searchSavedItemsSemantic({
        ownerUserId: "owner-1",
        query: "filter size",
        includeArchived: true,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ savedItemId: active.id }),
        expect.objectContaining({ savedItemId: archived.id }),
      ]),
    );
  });
});
