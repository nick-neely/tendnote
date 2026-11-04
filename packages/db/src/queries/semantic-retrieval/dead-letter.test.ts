import { EMBEDDING_JOB_MAX_ATTEMPTS, EMBEDDING_JOB_MAX_TRANSIENT_ATTEMPTS } from "@tendnote/domain";
import { UsagePausedError } from "@tendnote/domain/usage-bounds";
import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";
import { isInputRejection, isTransientFailure } from "./steps";
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

    // The edit, then the enqueue its save schedules: the only reopen this job gets.
    await harness.store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { content: "Mara likes ceramics and glazing." },
    });
    const { job: reopened, created } = await enqueue();
    expect(created).toBe(false);
    expect(reopened.id).toBe(job.id);
    expect(await harness.store.getEmbeddingJob(job.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    const retried = await runPass(harness, new Date());
    expect(retried?.job).toMatchObject({ id: job.id, status: "failed", attempts: 1 });
  });

  it("dead-letters a re-saved record with unchanged text again without calling the provider", async () => {
    let calls = 0;
    const harness = createHarness({
      adapter: {
        async embedText(request) {
          calls += 1;
          if (request.text.includes("glazing")) {
            return { vector: [1, 0, 0, 0], model: request.model, version: request.version };
          }
          throw new Error("This model's maximum context length is 8192 tokens.");
        },
      },
    });
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
    const dead = await harness.store.getEmbeddingJob(job.id);
    expect(dead?.status).toBe("dead_lettered");
    expect(dead?.deadLetteredFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toBe(EMBEDDING_JOB_MAX_ATTEMPTS);

    // Same text: straight back to dead-lettered, no provider call.
    await enqueue();
    const unchanged = await runPass(harness, now);
    expect(unchanged?.job.status).toBe("dead_lettered");
    expect(unchanged?.job.lastError).toContain("unchanged");
    expect(calls).toBe(EMBEDDING_JOB_MAX_ATTEMPTS);

    // New text: the provider is tried again, and success clears the fingerprint.
    await harness.store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { content: "Mara likes ceramics and glazing." },
    });
    await enqueue();
    const changed = await runPass(harness, new Date(now.getTime() + 60 * 60 * 1000));
    expect(changed?.outcome).toBe("completed");
    expect(changed?.job.deadLetteredFingerprint).toBeNull();
    expect(calls).toBe(EMBEDDING_JOB_MAX_ATTEMPTS + 1);
  });

  it("gives back the attempt of a claim that stale recovery requeues", async () => {
    const harness = createHarness({ adapter: refusingAdapter });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const { job } = await harness.processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    let now = new Date();
    for (let abandoned = 0; abandoned < EMBEDDING_JOB_MAX_ATTEMPTS; abandoned += 1) {
      const claimed = await harness.store.claimNextEmbeddingJob({ now });
      expect(claimed?.attempts).toBe(1);
      now = new Date(now.getTime() + 60 * 60 * 1000);
      const { jobs } = await harness.processor.recoverStaleEmbeddingJobs({
        now,
        leaseDurationMs: 10 * 60 * 1000,
      });
      expect(jobs.map((recovered) => recovered.attempts)).toEqual([0]);
    }

    const failed = await runPass(harness, now);
    expect(failed?.job).toMatchObject({ id: job.id, status: "failed", attempts: 1 });
  });

  it("gives a fresh budget to an edit that lands during a run stale recovery requeues", async () => {
    const { store, processor, createApprovedMemory } = createHarness({ adapter: refusingAdapter });
    const memory = await createApprovedMemory({ content: "Mara likes ceramics." });
    const enqueue = () =>
      processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    const { job } = await enqueue();
    for (let claim = 0; claim < EMBEDDING_JOB_MAX_ATTEMPTS - 1; claim += 1) {
      await store.claimEmbeddingJob({ jobId: job.id, now: new Date() });
      await store.updateEmbeddingJob({ jobId: job.id, status: "failed", claimedAt: null });
    }
    const claimedAt = new Date();
    const claimed = await store.claimEmbeddingJob({ jobId: job.id, now: claimedAt });
    expect(claimed?.attempts).toBe(EMBEDDING_JOB_MAX_ATTEMPTS);
    await enqueue();

    const { jobs } = await processor.recoverStaleEmbeddingJobs({
      now: new Date(claimedAt.getTime() + 60 * 60 * 1000),
      leaseDurationMs: 10 * 60 * 1000,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", attempts: 0, rerunRequestedAt: null });
  });

  it("does not spend the failure budget on passes the Account Ceiling deferred", async () => {
    let paused = true;
    const harness = createHarness({
      adapter: {
        async embedText() {
          if (paused) throw UsagePausedError.atCeiling("2026-11-15");
          throw new Error("provider unavailable");
        },
      },
    });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const { job } = await harness.processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    let now = new Date();
    for (let pass = 0; pass < EMBEDDING_JOB_MAX_ATTEMPTS; pass += 1) {
      await harness.store.updateEmbeddingJob({ jobId: job.id, runAfter: now });
      const result = await runPass(harness, now);
      expect(result?.outcome).toBe("deferred");
      expect(result?.job.attempts).toBe(0);
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }

    paused = false;
    await harness.store.updateEmbeddingJob({ jobId: job.id, runAfter: now });
    const failed = await runPass(harness, now);
    expect(failed?.outcome).toBe("failed");
    expect(failed?.job.status).toBe("failed");
    expect(failed?.job.attempts).toBe(1);
  });

  it("gives a failed job a fresh budget when its record is edited, keeping the backoff", async () => {
    const harness = createHarness({ adapter: refusingAdapter });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const enqueue = () =>
      harness.processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    await enqueue();

    let now = new Date();
    let last = null;
    for (let pass = 1; pass < EMBEDDING_JOB_MAX_ATTEMPTS; pass += 1) {
      last = await runPass(harness, now);
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }
    expect(last?.job).toMatchObject({ status: "failed", attempts: EMBEDDING_JOB_MAX_ATTEMPTS - 1 });

    const { job: edited } = await enqueue();
    expect(edited).toMatchObject({ status: "failed", attempts: 0 });
    expect(edited.runAfter).toEqual(last?.job.runAfter);
  });

  it("gives a fresh budget to an edit that lands while a failing pass is running", async () => {
    const { store, processor, createApprovedMemory } = createHarness({ adapter: refusingAdapter });
    const memory = await createApprovedMemory({ content: "Mara likes ceramics." });
    const enqueue = () =>
      processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    const { job } = await enqueue();
    await store.updateEmbeddingJob({ jobId: job.id, status: "failed", runAfter: new Date() });
    for (let claim = 0; claim < 3; claim += 1) {
      await store.claimEmbeddingJob({ jobId: job.id, now: new Date() });
      await store.updateEmbeddingJob({ jobId: job.id, status: "failed", claimedAt: null });
    }
    await store.claimEmbeddingJob({ jobId: job.id, now: new Date() });
    await enqueue();

    const result = await processor.processEmbeddingJob({ jobId: job.id, claim: false });
    expect(result.outcome).toBe("failed");
    expect(result.job).toMatchObject({ status: "failed", attempts: 0, rerunRequestedAt: null });
  });

  it("keeps retrying transient failures past the cap, and keeps no fingerprint when they dead-letter", async () => {
    let calls = 0;
    let outage = true;
    const harness = createHarness({
      adapter: {
        async embedText(request) {
          calls += 1;
          if (outage) {
            throw Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
          }
          return { vector: [1, 0, 0, 0], model: request.model, version: request.version };
        },
      },
    });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    const enqueue = () =>
      harness.processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    const { job } = await enqueue();

    let now = new Date();
    for (let pass = 1; pass < EMBEDDING_JOB_MAX_TRANSIENT_ATTEMPTS; pass += 1) {
      const result = await runPass(harness, now);
      expect(result?.job.status).toBe("failed");
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }
    const last = await runPass(harness, now);
    expect(last?.job).toMatchObject({
      status: "dead_lettered",
      attempts: EMBEDDING_JOB_MAX_TRANSIENT_ATTEMPTS,
      deadLetteredFingerprint: null,
    });

    // The outage is over and the record is re-saved unchanged: the provider is tried again.
    outage = false;
    await enqueue();
    const retried = await runPass(harness, new Date(now.getTime() + 60 * 60 * 1000));
    expect(retried?.outcome).toBe("completed");
    expect(calls).toBe(EMBEDDING_JOB_MAX_TRANSIENT_ATTEMPTS + 1);
    expect((await harness.store.getEmbeddingJob(job.id))?.status).toBe("completed");
  });

  it("dead-letters a failure that is neither transient nor a refused input at the normal cap", async () => {
    const harness = createHarness({
      adapter: {
        async embedText() {
          throw new Error("Unexpected embedding response shape.");
        },
      },
    });
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    await harness.processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    let now = new Date();
    let last = null;
    for (let pass = 0; pass < EMBEDDING_JOB_MAX_ATTEMPTS; pass += 1) {
      last = await runPass(harness, now);
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }
    expect(last?.job).toMatchObject({ status: "dead_lettered", deadLetteredFingerprint: null });
  });

  it("keeps retrying a restricted scrub past the cap until the delete succeeds", async () => {
    const harness = createHarness();
    const { store } = harness;
    const memory = await harness.createApprovedMemory({ content: "Mara likes ceramics." });
    await harness.embedMemory(memory.id);
    await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "restricted" },
    });
    const { job } = await harness.processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    const deleteForClaim = store.deleteRelationshipContextEmbeddingsForRecordForClaim;
    let databaseDown = true;
    store.deleteRelationshipContextEmbeddingsForRecordForClaim = async (input) => {
      if (databaseDown) throw new Error("database connection lost");
      return deleteForClaim(input);
    };

    let now = new Date();
    for (let pass = 0; pass < EMBEDDING_JOB_MAX_ATTEMPTS + 2; pass += 1) {
      const result = await runPass(harness, now);
      expect(result?.job.status).toBe("failed");
      now = new Date(now.getTime() + 60 * 60 * 1000);
    }
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);

    databaseDown = false;
    const scrubbed = await runPass(harness, now);
    expect(scrubbed).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "restricted_content" }),
    );
    expect((await store.getEmbeddingJob(job.id))?.status).not.toBe("dead_lettered");
    await expect(store.listRelationshipContextEmbeddings()).resolves.toEqual([]);
  });
});

describe("isTransientFailure", () => {
  it("treats rate limits, server errors, timeouts and dropped connections as transient", () => {
    expect(
      isTransientFailure(Object.assign(new Error("Too Many Requests"), { statusCode: 429 })),
    ).toBe(true);
    expect(
      isTransientFailure(
        Object.assign(new Error("Failed after 3 attempts."), {
          lastError: Object.assign(new Error("Bad Gateway"), { statusCode: 502 }),
        }),
      ),
    ).toBe(true);
    expect(isTransientFailure(new Error("The operation was aborted due to timeout"))).toBe(true);
    expect(
      isTransientFailure(
        new Error("Failed query: select 1", {
          cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "08006" }),
        }),
      ),
    ).toBe(true);
    expect(isTransientFailure(Object.assign(new Error("read"), { code: "ECONNRESET" }))).toBe(true);
  });

  it("does not treat a refused input or an unknown failure as transient", () => {
    expect(
      isTransientFailure(new Error("This model's maximum context length is 8192 tokens.")),
    ).toBe(false);
    expect(isTransientFailure(Object.assign(new Error("Bad Request"), { statusCode: 400 }))).toBe(
      false,
    );
    expect(isTransientFailure(new Error("Unexpected embedding response shape."))).toBe(false);
    expect(
      isTransientFailure(
        new Error("Failed query: insert", {
          cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
        }),
      ),
    ).toBe(false);
  });
});

describe("isInputRejection", () => {
  it("treats a refused input as permanent", () => {
    expect(isInputRejection(new Error("This model's maximum context length is 8192 tokens."))).toBe(
      true,
    );
    expect(isInputRejection(Object.assign(new Error("Bad Request"), { statusCode: 400 }))).toBe(
      true,
    );
    expect(
      isInputRejection(Object.assign(new Error("Payload Too Large"), { statusCode: 413 })),
    ).toBe(true);
    // The AI SDK's retry wrapper and a gateway's cause both hide the provider's answer.
    expect(
      isInputRejection(
        Object.assign(new Error("Failed after 3 attempts."), {
          lastError: Object.assign(new Error("Unprocessable"), { statusCode: 422 }),
        }),
      ),
    ).toBe(true);
    expect(
      isInputRejection(
        new Error("Gateway request failed", {
          cause: new Error("input is too long for this model"),
        }),
      ),
    ).toBe(true);
  });

  it("treats outages, rate limits and timeouts as transient", () => {
    expect(
      isInputRejection(Object.assign(new Error("Service Unavailable"), { statusCode: 503 })),
    ).toBe(false);
    expect(
      isInputRejection(Object.assign(new Error("Too Many Requests"), { statusCode: 429 })),
    ).toBe(false);
    expect(
      isInputRejection(
        Object.assign(new Error("Failed after 3 attempts."), {
          lastError: Object.assign(new Error("Internal Server Error"), { statusCode: 500 }),
        }),
      ),
    ).toBe(false);
    expect(
      isInputRejection(
        Object.assign(new Error("Rate limit reached on tokens per min: token limit 1000000"), {
          statusCode: 429,
        }),
      ),
    ).toBe(false);
    // The AI SDK's retry wrapper has no status, but its message quotes the 429's text.
    expect(
      isInputRejection(
        Object.assign(
          new Error(
            "Failed after 3 attempts. Last error: Rate limit reached: token limit exceeded",
          ),
          {
            lastError: Object.assign(new Error("Rate limit reached: token limit exceeded"), {
              statusCode: 429,
            }),
          },
        ),
      ),
    ).toBe(false);
    expect(isInputRejection(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isInputRejection(new Error("provider unavailable"))).toBe(false);
  });
});
