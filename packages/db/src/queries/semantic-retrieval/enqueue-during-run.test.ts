import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createHarness, OWNER } from "./harness";
import type { EmbeddingAdapter, EmbeddingJobLifecycleStore } from "./types";

/**
 * An edit that lands while a job is running.
 *
 * A run reads its record once, at the top, and then spends its time inside the provider
 * call. An edit that arrives in that window is invisible to the run, and the enqueue
 * announcing it finds a job in a status it cannot reopen: setting a `running` job back to
 * `pending` only lets the finishing run write its own verdict over the top, which loses the
 * request just as silently. So the enqueue records `rerunRequestedAt` and the run consumes
 * it as it settles, landing on `pending` instead of on its verdict (#330).
 *
 * The interleaving is driven explicitly here rather than approximated by editing between
 * two passes: the whole point is what happens to a decision already in flight, and only a
 * hook inside the provider call puts an edit there.
 */

const EDITED_CONTENT = "Mara switched to pottery studio gift ideas.";

/**
 * A harness whose provider call can run an arbitrary step midway through.
 *
 * `interleave` arms a one-shot hook for the next `embedText`, which is the window a real
 * edit would land in. The vector is numbered by call so the row left behind names the pass
 * that wrote it.
 */
function createInterleavedHarness() {
  let calls = 0;
  let pending: (() => Promise<void>) | null = null;
  const adapter: EmbeddingAdapter = {
    async embedText(request) {
      calls += 1;
      const hook = pending;
      pending = null;
      await hook?.();

      return { vector: [calls, 0, 0, 0], model: request.model, version: request.version };
    },
  };
  const harness = createHarness({ adapter });

  return {
    ...harness,
    get adapterCalls() {
      return calls;
    },
    interleave(step: () => Promise<void>) {
      pending = step;
    },
    enqueue(recordId: string) {
      return harness.processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId,
      });
    },
  };
}

describe("an enqueue that lands while its embedding job is running", () => {
  it("re-embeds the record as it stands after the edit, not as the run read it", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    harness.interleave(async () => {
      await harness.store.updateMemory({
        ownerUserId: OWNER,
        memoryId: memory.id,
        patch: { content: EDITED_CONTENT },
      });
      const requested = await harness.enqueue(memory.id);

      expect(requested.created).toBe(false);
      expect(requested.job.id).toBe(job.id);
      expect(requested.job.status).toBe("running");
      expect(requested.job.rerunRequestedAt).toBeInstanceOf(Date);
    });

    const inFlight = await harness.processor.processEmbeddingJob({ jobId: job.id });

    // The run really did complete - it embedded the text it read - but its verdict is not
    // allowed to be the last word on a record that has moved since.
    expect(inFlight.outcome).toBe("completed");
    expect(inFlight.embedding?.embeddedText).toBe(memory.content);
    expect(inFlight.job.status).toBe("pending");
    expect(inFlight.job.rerunRequestedAt).toBeNull();
    expect(inFlight.job.completedAt).toBeNull();
    expect(inFlight.job.claimedAt).toBeNull();

    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(rerun.outcome).toBe("completed");
    expect(rerun.embedding?.embeddedText).toBe(EDITED_CONTENT);
    expect(rerun.job.status).toBe("completed");
    await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toEqual([
      expect.objectContaining({ embeddedText: EDITED_CONTENT, embedding: [2, 0, 0, 0] }),
    ]);
  });

  it("asks for exactly one more pass, and that pass settles normally", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    harness.interleave(async () => {
      await harness.store.updateMemory({
        ownerUserId: OWNER,
        memoryId: memory.id,
        patch: { content: EDITED_CONTENT },
      });
      await harness.enqueue(memory.id);
    });

    await harness.processor.processEmbeddingJob({ jobId: job.id });
    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });
    // Nothing is left queued: the marker is consumed by the pass it scheduled, so a third
    // attempt finds a terminal job rather than another rerun.
    const afterwards = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(rerun.job.rerunRequestedAt).toBeNull();
    expect(afterwards.outcome).toBe("not_claimable");
    expect(afterwards.job.status).toBe("completed");
    expect(harness.adapterCalls).toBe(2);
  });

  /**
   * The marker survives a duplicate pass finishing after the pass that consumed it.
   *
   * Two passes can hold one job at once: `claimJobForProcessing` runs a job that is already
   * `running` without re-claiming it, so an at-least-once redelivery lands a second pass
   * beside the first. Both read the record before the edit and both mean to write a
   * verdict, but only the first finds the marker. An unguarded second write would put
   * `completed` over the `pending` the first one produced, stranding the edit on a terminal
   * job - the exact loss the marker exists to prevent, reintroduced one layer down.
   *
   * The duplicate's settle is issued directly because that is precisely what it is: the
   * same call {@link processEmbeddingJob} makes for a completed pass, arriving late.
   */
  it("keeps the rerun when a superseded duplicate pass settles after the marker was consumed", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    harness.interleave(async () => {
      await harness.store.updateMemory({
        ownerUserId: OWNER,
        memoryId: memory.id,
        patch: { content: EDITED_CONTENT },
      });
      await harness.enqueue(memory.id);
    });

    const inFlight = await harness.processor.processEmbeddingJob({ jobId: job.id });
    expect(inFlight.job.status).toBe("pending");

    const superseded = await harness.store.settleEmbeddingJob({
      jobId: job.id,
      status: "completed",
      now: new Date(),
      completedAt: new Date(),
      lastError: null,
    });

    // The late verdict is dropped whole: the job is still the queued rerun, not a
    // completed one, and it carries none of the settling the duplicate tried to write.
    expect(superseded.status).toBe("pending");
    expect(superseded.completedAt).toBeNull();
    expect(superseded.claimedAt).toBeNull();

    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(rerun.outcome).toBe("completed");
    expect(rerun.embedding?.embeddedText).toBe(EDITED_CONTENT);
    await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toEqual([
      expect.objectContaining({ embeddedText: EDITED_CONTENT }),
    ]);
  });

  it("costs no second provider call when the record did not actually change", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    harness.interleave(async () => {
      await harness.enqueue(memory.id);
    });

    await harness.processor.processEmbeddingJob({ jobId: job.id });
    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });

    // The extra pass is a re-decision, not a re-embed: the content fingerprint still
    // matches, so the row is reused and the provider is never asked again.
    expect(rerun.outcome).toBe("completed");
    expect(harness.adapterCalls).toBe(1);
    await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
  });

  /**
   * The sharpest form of the race, and the reason it is a privacy fix rather than a
   * freshness one. The run read a `normal` memory, the owner restricted it mid-run, and the
   * run then wrote the pre-restriction text and the vector derived from it. Without the
   * marker nothing re-decided the record, so `scrubRestrictedEmbeddings` never ran and that
   * text stayed stored - held back only by the search seam's sensitivity equality.
   */
  it("scrubs a record that was restricted while its job was running", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    harness.interleave(async () => {
      await harness.store.updateMemory({
        ownerUserId: OWNER,
        memoryId: memory.id,
        patch: { sensitivity: "restricted" },
      });
      await harness.enqueue(memory.id);
    });

    const inFlight = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(inFlight.outcome).toBe("completed");
    await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);

    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(rerun).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "restricted_content" }),
    );
    await expect(harness.store.listRelationshipContextEmbeddings()).resolves.toEqual([]);
    await expect(harness.auditActions()).resolves.toContain("embedding_job.restricted_scrubbed");
  });

  it("re-decides after a skip, because eligibility was judged on the state that changed", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory({ status: "suggested", approvedAt: null });
    const { job } = await harness.enqueue(memory.id);
    // A skip never reaches the provider, so the interleaving is driven through the queue
    // directly: claim the job, then enqueue against the claim.
    await harness.store.claimEmbeddingJob({ jobId: job.id, now: new Date() });
    await harness.enqueue(memory.id);

    const inFlight = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(inFlight).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "memory_not_approved" }),
    );
    expect(inFlight.job.status).toBe("pending");
    expect(inFlight.job.rerunRequestedAt).toBeNull();

    const rerun = await harness.processor.processEmbeddingJob({ jobId: job.id });

    expect(rerun.job.status).toBe("skipped");
    expect(rerun.job.rerunRequestedAt).toBeNull();
  });

  /**
   * A failed run is the one verdict that stands: its retry backoff already schedules the
   * extra pass the marker is asking for, and that retry reads the record as it now stands.
   * Downgrading it to `pending` would only throw away the failure and its backoff.
   */
  it("lets a failed verdict stand, because the retry is already the extra pass", async () => {
    const failing: EmbeddingAdapter = {
      async embedText() {
        throw new Error("provider unavailable");
      },
    };
    const { store, processor, createApprovedMemory } = createHarness({ adapter: failing });
    const memory = await createApprovedMemory();
    const enqueue = () =>
      processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
    const { job } = await enqueue();
    await store.claimEmbeddingJob({ jobId: job.id, now: new Date() });
    await enqueue();

    const result = await processor.processEmbeddingJob({ jobId: job.id, retryDelayMs: 60_000 });

    expect(result.outcome).toBe("failed");
    expect(result.job.status).toBe("failed");
    expect(result.job.lastError).toBe("provider unavailable");
    expect(result.job.rerunRequestedAt).toBeNull();
    await expect(
      store.claimEmbeddingJob({ jobId: job.id, now: new Date(result.job.runAfter.getTime() + 1) }),
    ).resolves.toEqual(expect.objectContaining({ status: "running" }));
  });
});

/**
 * The marker is for the one status that needs it. Every other status is either already
 * going to re-decide the record or is reopened outright, and the reopen semantics those
 * rest on are the ones #329 established - so they are pinned here beside the new case
 * rather than left to be inferred from it.
 */
describe("a repeat enqueue against a job that is not running", () => {
  async function enqueueTwice(
    prepare?: (
      harness: ReturnType<typeof createInterleavedHarness>,
      jobId: string,
    ) => Promise<void>,
  ) {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const first = await harness.enqueue(memory.id);
    await prepare?.(harness, first.job.id);
    const second = await harness.enqueue(memory.id);

    return { harness, first: first.job, second: second.job };
  }

  it("leaves a pending job exactly as it found it", async () => {
    const { first, second } = await enqueueTwice();

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("pending");
    expect(second.rerunRequestedAt).toBeNull();
    expect(second.attempts).toBe(0);
  });

  it("keeps a failed job's backoff rather than pulling its retry forward", async () => {
    const runAfter = new Date(Date.now() + 600_000);
    const { second } = await enqueueTwice(async (harness, jobId) => {
      await harness.store.updateEmbeddingJob({
        jobId,
        status: "failed",
        lastError: "provider unavailable",
        runAfter,
      });
    });

    // A failed job is claimable and will re-decide the record when its backoff elapses, so
    // an enqueue has nothing to add - and pulling the retry forward would defeat the point
    // of the backoff.
    expect(second.status).toBe("failed");
    expect(second.runAfter).toEqual(runAfter);
    expect(second.lastError).toBe("provider unavailable");
    expect(second.rerunRequestedAt).toBeNull();
  });

  it("reopens a completed job to pending and clears what the run left behind", async () => {
    const harness = createInterleavedHarness();
    const memory = await harness.createApprovedMemory();
    const { job } = await harness.enqueue(memory.id);
    const completed = await harness.processor.processEmbeddingJob({ jobId: job.id });
    const reopened = await harness.enqueue(memory.id);

    expect(completed.job.status).toBe("completed");
    expect(reopened.created).toBe(false);
    expect(reopened.job.status).toBe("pending");
    expect(reopened.job.completedAt).toBeNull();
    expect(reopened.job.claimedAt).toBeNull();
    expect(reopened.job.lastError).toBeNull();
    expect(reopened.job.rerunRequestedAt).toBeNull();
  });
});

/**
 * Both handoffs live in the Drizzle store as single conditional statements, and that is the
 * property that makes them durable rather than merely usually right. A read-then-write
 * would lose exactly the edit this all exists to keep: the row can be claimed, or can
 * settle, between the read and the write, and the write would then land on a status whose
 * branch was never chosen for it.
 *
 * There is no live database in this suite, so the statements are captured as drizzle builds
 * them and read back as SQL - which is the executable form, not the prose around it.
 */
describe("the Drizzle store decides both handoffs inside one statement", () => {
  const dialect = new PgDialect();
  // biome-ignore lint/suspicious/noExplicitAny: rendering whatever drizzle was handed.
  const query = (value: unknown) => dialect.sqlToQuery(value as any);
  const rendered = (value: unknown) => query(value).sql;
  const isSql = (value: unknown) =>
    typeof value === "object" && value !== null && "queryChunks" in value;

  async function captureStatement(
    run: (store: EmbeddingJobLifecycleStore) => Promise<unknown>,
  ): Promise<{ set: Record<string, unknown>; where: unknown }> {
    const captured: { set: Record<string, unknown>; where: unknown }[] = [];
    const db = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (predicate: unknown) => {
            captured.push({ set: values, where: predicate });

            return { returning: async () => [{ id: "job-1" }] };
          },
        }),
      }),
    };

    vi.doMock("../../client", () => ({ getDb: () => db }));
    vi.resetModules();
    const { createDrizzleEmbeddingStore } = await import("./drizzle-store");
    await run(createDrizzleEmbeddingStore());
    vi.doUnmock("../../client");

    const [statement] = captured;
    if (!statement) throw new Error("No update statement was built.");

    return statement;
  }

  async function captureSetClause(
    run: (store: EmbeddingJobLifecycleStore) => Promise<unknown>,
  ): Promise<Record<string, unknown>> {
    return (await captureStatement(run)).set;
  }

  it("marks a rerun only for a running job, and reopens only a terminal verdict", async () => {
    const clause = await captureSetClause((store) =>
      store.reopenEmbeddingJob({ jobId: "job-1", now: new Date(), runAfter: new Date() }),
    );

    // The marker arm tests the status inside the statement, so a job that stopped running
    // between the caller's read and this write cannot be marked.
    expect(rendered(clause.rerunRequestedAt)).toBe(
      'case when "relationship_context_embedding_jobs"."status" = $1 then $2::timestamptz else null end',
    );
    for (const column of ["status", "runAfter", "claimedAt", "completedAt", "lastError"]) {
      expect(rendered(clause[column])).toContain(
        '"relationship_context_embedding_jobs"."status" in ($1, $2)',
      );
    }
  });

  /**
   * The marker is durable only if the settle that consumes it is the last word. Two passes
   * can be in flight over one job - `claimJobForProcessing` runs an already-`running` job
   * without re-claiming, which is how a redelivery makes progress - and both hold the same
   * `claimedAt`, so the status is the only thing that distinguishes the superseded one.
   */
  it("settles only the row's current running pass, so a superseded verdict writes nothing", async () => {
    const { where } = await captureStatement((store) =>
      store.settleEmbeddingJob({
        jobId: "job-1",
        status: "completed",
        now: new Date(),
        completedAt: new Date(),
        lastError: null,
      }),
    );

    expect(rendered(where)).toContain('"relationship_context_embedding_jobs"."status" = ');
    expect(query(where).params).toContain("running");
  });

  it("reads the rerun marker in the statement that writes the verdict and clears it", async () => {
    const clause = await captureSetClause((store) =>
      store.settleEmbeddingJob({
        jobId: "job-1",
        status: "completed",
        now: new Date(),
        completedAt: new Date(),
        lastError: null,
      }),
    );

    for (const column of ["status", "runAfter", "claimedAt", "completedAt", "lastError"]) {
      expect(rendered(clause[column])).toContain(
        '"relationship_context_embedding_jobs"."rerun_requested_at" is not null',
      );
    }
    expect(clause.rerunRequestedAt).toBeNull();
  });

  /**
   * A parameter inside a `sql` template skips the column mapping drizzle applies to an
   * ordinary `set` value, and the driver then refuses the raw `Date` it is handed - at
   * runtime, on the one statement no unit test in this suite executes. Every timestamp in
   * these clauses is therefore bound as an ISO string with an explicit cast, and that is
   * asserted rather than trusted.
   */
  it("binds every timestamp in the hand-built clauses as a driver-serializable value", async () => {
    // Captured one after another: each capture swaps the module registry out from under
    // the store, so two in flight at once would read each other's mock.
    const clauses = [
      await captureSetClause((store) =>
        store.reopenEmbeddingJob({ jobId: "job-1", now: new Date(), runAfter: new Date() }),
      ),
      await captureSetClause((store) =>
        store.settleEmbeddingJob({
          jobId: "job-1",
          status: "completed",
          now: new Date(),
          completedAt: new Date(),
          lastError: null,
        }),
      ),
    ];

    for (const clause of clauses) {
      for (const value of Object.values(clause)) {
        if (!isSql(value)) continue;
        expect(query(value).params.filter((param) => param instanceof Date)).toEqual([]);
      }
    }
  });

  it("needs no branch for a failed verdict, and still consumes the marker", async () => {
    const clause = await captureSetClause((store) =>
      store.settleEmbeddingJob({
        jobId: "job-1",
        status: "failed",
        now: new Date(),
        lastError: "provider unavailable",
        runAfter: new Date(),
        claimedAt: null,
      }),
    );

    expect(clause.status).toBe("failed");
    expect(clause.lastError).toBe("provider unavailable");
    expect(clause.rerunRequestedAt).toBeNull();
  });
});
