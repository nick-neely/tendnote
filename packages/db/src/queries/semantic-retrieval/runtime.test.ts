import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";
import {
  enqueueAndTriggerSemanticEmbeddingJobWithProcessor,
  resolveSemanticEmbeddingRuntimeMode,
} from "./runtime";

describe("semantic embedding runtime mode", () => {
  it("defaults local development to inline processing and production to enqueue-only", () => {
    expect(resolveSemanticEmbeddingRuntimeMode({ nodeEnv: "development" })).toBe("inline");
    expect(resolveSemanticEmbeddingRuntimeMode({ nodeEnv: "test" })).toBe("inline");
    expect(resolveSemanticEmbeddingRuntimeMode({ nodeEnv: "production" })).toBe("enqueue_only");
  });

  it("lets deployment configuration override the default runtime mode", () => {
    expect(
      resolveSemanticEmbeddingRuntimeMode({ configured: "inline", nodeEnv: "production" }),
    ).toBe("inline");
    expect(
      resolveSemanticEmbeddingRuntimeMode({
        configured: "enqueue_only",
        nodeEnv: "development",
      }),
    ).toBe("enqueue_only");
  });
});

describe("enqueue and trigger semantic embeddings", () => {
  it("can process an approved-memory embedding inline after enqueueing", async () => {
    const { processor, store, createApprovedMemory } = createHarness();
    const memory = await createApprovedMemory();

    const result = await enqueueAndTriggerSemanticEmbeddingJobWithProcessor(processor, {
      ownerUserId: memory.ownerUserId,
      recordKind: "memory",
      recordId: memory.id,
      runtimeMode: "inline",
    });

    expect(result.created).toBe(true);
    expect(result.processResult?.outcome).toBe("completed");
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
  });

  it("can leave an embedding job queued for workers", async () => {
    const { processor, store, createApprovedMemory } = createHarness();
    const memory = await createApprovedMemory();

    const result = await enqueueAndTriggerSemanticEmbeddingJobWithProcessor(processor, {
      ownerUserId: memory.ownerUserId,
      recordKind: "memory",
      recordId: memory.id,
      runtimeMode: "enqueue_only",
    });

    expect(result.created).toBe(true);
    expect(result.processResult).toBeNull();
    await expect(store.getEmbeddingJob(result.job.id)).resolves.toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });
});
