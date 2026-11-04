import { EMBEDDING_JOB_MAX_ATTEMPTS } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";
import type { EmbeddingAdapter } from "./types";

/** A provider that refuses this record's text on every pass, as a too-long input would. */
const refusingAdapter: EmbeddingAdapter = {
  async embedText() {
    throw new Error("This model's maximum context length is 8192 tokens.");
  },
};

/** Runs one recovery-style pass: claim the next due job, then process it without re-claiming. */
async function runPass(harness: ReturnType<typeof createHarness>, now: Date) {
  const claimed = await harness.store.claimNextEmbeddingJob({ now });
  if (!claimed) return null;
  return harness.processor.processEmbeddingJob({ jobId: claimed.id, claim: false, now });
}

describe("embedding job dead-lettering", () => {
  it("stops retrying a job the provider keeps refusing once it reaches the attempt cap", async () => {
    const harness = createHarness({ adapter: refusingAdapter });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const { job } = await harness.processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    let now = new Date();
    for (let pass = 1; pass < EMBEDDING_JOB_MAX_ATTEMPTS; pass += 1) {
      const result = await runPass(harness, now);
      expect(result?.outcome).toBe("failed");
      expect(result?.job.status).toBe("failed");
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }

    const last = await runPass(harness, now);
    expect(last?.outcome).toBe("failed");
    expect(last?.job.status).toBe("dead_lettered");
    expect(last?.job.attempts).toBe(EMBEDDING_JOB_MAX_ATTEMPTS);
    expect(last?.job.lastError).toContain("maximum context length");

    // Nothing left to claim, however much later the next pass runs.
    expect(await runPass(harness, new Date(now.getTime() + 24 * 60 * 60 * 1000))).toBeNull();
    expect((await harness.store.getEmbeddingJob(job.id))?.status).toBe("dead_lettered");
  });

  it("gives a dead-lettered job a fresh set of attempts when its record is edited", async () => {
    const harness = createHarness({ adapter: refusingAdapter });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const enqueue = () =>
      harness.processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    const { job } = await enqueue();

    let now = new Date();
    for (let pass = 0; pass < EMBEDDING_JOB_MAX_ATTEMPTS; pass += 1) {
      await runPass(harness, now);
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }
    expect((await harness.store.getEmbeddingJob(job.id))?.status).toBe("dead_lettered");

    const { job: reopened, created } = await enqueue();
    expect(created).toBe(false);
    expect(reopened.id).toBe(job.id);
    expect(reopened.status).toBe("pending");
    expect(reopened.attempts).toBe(0);
    expect(reopened.lastError).toBeNull();

    const retried = await runPass(harness, new Date());
    expect(retried?.job.status).toBe("failed");
  });
});
