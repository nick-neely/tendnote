import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryOwnerDataExportArtifactStore,
  createInMemoryOwnerDataExportJobStore,
} from "./in-memory-store";
import {
  enqueueAndTriggerOwnerDataExportJob,
  expireOwnerDataExportArtifacts,
  ownerDataExportRequestIdempotencyKey,
  processOwnerDataExportJob,
} from "./processor";

describe("owner data export jobs", () => {
  it("keeps enqueue idempotent and processes a durable artifact exactly once", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const generate = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      manifest: {} as never,
    });
    const first = await enqueueAndTriggerOwnerDataExportJob(
      {
        ownerUserId: "owner-1",
        idempotencyKey: "request-1",
        runtimeMode: "inline",
      },
      { jobs, artifacts, generate },
    );
    const second = await enqueueAndTriggerOwnerDataExportJob(
      {
        ownerUserId: "owner-1",
        idempotencyKey: "request-1",
        runtimeMode: "inline",
      },
      { jobs, artifacts, generate },
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.processResult?.outcome).toBe("completed");
    expect(second.processResult?.outcome).toBe("completed");
    expect(generate).toHaveBeenCalledOnce();
    await expect(
      artifacts.get({ jobId: first.job.id, ownerUserId: "owner-1" }),
    ).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
  });

  it("scopes idempotency keys to the owner", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const first = await jobs.enqueue({ ownerUserId: "owner-1", idempotencyKey: "request-1" });
    const second = await jobs.enqueue({ ownerUserId: "owner-2", idempotencyKey: "request-1" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
    await expect(
      jobs.enqueue({ ownerUserId: "owner-1", idempotencyKey: "request-1" }),
    ).resolves.toMatchObject({ created: false, job: { id: first.job.id } });
  });

  it("collapses concurrent Account requests with one request-stable database key", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const request = async () => {
      const latest = await jobs.getLatestForOwner({ ownerUserId: "owner-1" });
      if (
        latest?.status === "pending" ||
        latest?.status === "running" ||
        latest?.status === "failed"
      ) {
        return { job: latest, created: false };
      }
      return jobs.enqueue({
        ownerUserId: "owner-1",
        idempotencyKey: ownerDataExportRequestIdempotencyKey(latest),
      });
    };

    const results = await Promise.all([request(), request(), request()]);

    expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]?.job.idempotencyKey).toBe("owner-data-export:request-after:initial");
  });

  it("records a processing failure as retryable state and recovers it after runAfter", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const now = new Date("2026-08-19T12:00:00.000Z");
    const { job } = await jobs.enqueue({ ownerUserId: "owner-1", now, idempotencyKey: "retry-1" });
    const failed = await processOwnerDataExportJob({
      jobId: job.id,
      jobs,
      artifacts,
      now,
      generate: vi.fn().mockRejectedValue(new Error("archive unavailable")),
    });
    expect(failed.outcome).toBe("failed");
    expect(failed.job).toMatchObject({ status: "failed", attempts: 1 });

    const notYetDue = await jobs.claimNext({ now: new Date(now.getTime() + 60_000) });
    expect(notYetDue).toBeNull();
    const recovered = await jobs.claimNext({ now: new Date(now.getTime() + 6 * 60_000) });
    expect(recovered).toMatchObject({ id: job.id, status: "running", attempts: 2 });
    if (!recovered?.claimToken) throw new Error("Expected a recovery claim token.");
    const completed = await processOwnerDataExportJob({
      jobId: job.id,
      jobs,
      artifacts,
      now: new Date(now.getTime() + 6 * 60_000),
      claim: false,
      claimToken: recovered.claimToken,
      generate: vi.fn().mockResolvedValue({ bytes: new Uint8Array([9]), manifest: {} as never }),
    });
    expect(completed.outcome).toBe("completed");
  });

  it("preserves newer bytes when a stale worker writes after the new worker completes", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const now = new Date("2026-08-19T12:00:00.000Z");
    const { job } = await jobs.enqueue({
      ownerUserId: "owner-1",
      now,
      idempotencyKey: "lease-completion",
    });
    const firstClaim = await jobs.claim({ jobId: job.id, now });
    if (!firstClaim?.claimToken) throw new Error("Expected the first claim token.");

    let finishGeneration: ((value: { bytes: Uint8Array; manifest: never }) => void) | undefined;
    const staleRun = processOwnerDataExportJob({
      jobId: job.id,
      jobs,
      artifacts,
      now,
      claim: false,
      claimToken: firstClaim.claimToken,
      generate: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finishGeneration = resolve;
          }),
      ),
    });
    await vi.waitFor(() => expect(finishGeneration).toBeTypeOf("function"));

    const secondClaim = await jobs.claim({
      jobId: job.id,
      now: new Date(now.getTime() + 11 * 60_000),
    });
    if (!secondClaim?.claimToken) throw new Error("Expected the reclaimed lease token.");
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    await expect(
      processOwnerDataExportJob({
        jobId: job.id,
        jobs,
        artifacts,
        now: new Date(now.getTime() + 11 * 60_000),
        claim: false,
        claimToken: secondClaim.claimToken,
        generate: vi.fn().mockResolvedValue({ bytes: new Uint8Array([2]), manifest: {} as never }),
      }),
    ).resolves.toMatchObject({ outcome: "completed", job: { status: "completed" } });

    finishGeneration?.({ bytes: new Uint8Array([1]), manifest: {} as never });
    await expect(staleRun).resolves.toMatchObject({ outcome: "not_claimable" });
    await expect(jobs.get({ jobId: job.id })).resolves.toMatchObject({ status: "completed" });
    await expect(
      artifacts.get({ jobId: job.id, ownerUserId: "owner-1", now }),
    ).resolves.toMatchObject({ bytes: new Uint8Array([2]) });
  });

  it("fences a stale failure after a newer worker reclaims the lease", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const now = new Date("2026-08-19T12:00:00.000Z");
    const { job } = await jobs.enqueue({
      ownerUserId: "owner-1",
      now,
      idempotencyKey: "lease-failure",
    });
    const firstClaim = await jobs.claim({ jobId: job.id, now });
    if (!firstClaim?.claimToken) throw new Error("Expected the first claim token.");

    let failGeneration: ((reason: Error) => void) | undefined;
    const staleRun = processOwnerDataExportJob({
      jobId: job.id,
      jobs,
      artifacts,
      now,
      claim: false,
      claimToken: firstClaim.claimToken,
      generate: vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            failGeneration = reject;
          }),
      ),
    });
    await vi.waitFor(() => expect(failGeneration).toBeTypeOf("function"));

    const secondClaim = await jobs.claim({
      jobId: job.id,
      now: new Date(now.getTime() + 11 * 60_000),
    });
    if (!secondClaim?.claimToken) throw new Error("Expected the reclaimed lease token.");
    failGeneration?.(new Error("stale worker failed"));

    await expect(staleRun).resolves.toMatchObject({ outcome: "not_claimable" });
    await expect(jobs.get({ jobId: job.id })).resolves.toMatchObject({
      status: "running",
      claimToken: secondClaim.claimToken,
      lastError: null,
    });
  });

  it("refuses cross-owner artifact reads and removes expired bytes", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const expiresAt = new Date("2026-08-20T12:00:00.000Z");
    const { job } = await jobs.enqueue({
      ownerUserId: "owner-1",
      idempotencyKey: "artifact-auth",
      now: new Date("2026-08-19T12:00:00.000Z"),
    });
    const claim = await jobs.claim({ jobId: job.id, now: new Date("2026-08-19T12:00:00.000Z") });
    if (!claim?.claimToken) throw new Error("Expected an artifact fixture claim token.");
    await artifacts.put({
      jobId: job.id,
      ownerUserId: "owner-1",
      expectedClaimToken: claim.claimToken,
      bytes: new Uint8Array([7]),
      expiresAt,
    });
    await expect(
      artifacts.get({ jobId: job.id, ownerUserId: "owner-2", now: new Date("2026-08-19") }),
    ).resolves.toBeNull();
    await expect(
      artifacts.get({ jobId: job.id, ownerUserId: "owner-1", now: expiresAt }),
    ).resolves.toBeNull();
    await expect(artifacts.deleteExpired({ now: expiresAt, limit: 10 })).resolves.toBe(1);
  });

  it("keeps expiry recoverable until recovery physically removes job and orphan bytes", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const now = new Date("2026-08-19T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { job } = await jobs.enqueue({
      ownerUserId: "owner-1",
      now,
      idempotencyKey: "expiry-recovery",
    });
    const claim = await jobs.claim({ jobId: job.id, now });
    if (!claim?.claimToken) throw new Error("Expected an expiry fixture claim token.");
    await artifacts.put({
      jobId: job.id,
      ownerUserId: "owner-1",
      expectedClaimToken: claim.claimToken,
      bytes: new Uint8Array([7]),
      expiresAt,
    });
    await jobs.markCompleted({
      jobId: job.id,
      expectedClaimToken: claim.claimToken,
      artifactExpiresAt: expiresAt,
      completedAt: now,
    });
    const { job: failedArtifactJob } = await jobs.enqueue({
      ownerUserId: "owner-1",
      now,
      idempotencyKey: "failed-artifact-cleanup",
    });
    const failedArtifactClaim = await jobs.claim({ jobId: failedArtifactJob.id, now });
    if (!failedArtifactClaim?.claimToken) {
      throw new Error("Expected a failed artifact fixture claim token.");
    }
    await artifacts.put({
      jobId: failedArtifactJob.id,
      ownerUserId: "owner-1",
      expectedClaimToken: failedArtifactClaim.claimToken,
      bytes: new Uint8Array([8]),
      expiresAt,
    });
    await jobs.markFailed({
      jobId: failedArtifactJob.id,
      expectedClaimToken: failedArtifactClaim.claimToken,
      error: "completion unavailable",
      runAfter: new Date(expiresAt.getTime() + 60_000),
    });

    const failingArtifacts = {
      ...artifacts,
      delete: vi.fn().mockRejectedValueOnce(new Error("artifact store unavailable")),
    };
    await expect(
      expireOwnerDataExportArtifacts({
        jobs,
        artifacts: failingArtifacts,
        now: expiresAt,
        limit: 10,
      }),
    ).rejects.toThrow("artifact store unavailable");
    await expect(jobs.get({ jobId: job.id })).resolves.toMatchObject({
      status: "expired",
      artifactExpiresAt: expiresAt,
    });

    await expect(
      expireOwnerDataExportArtifacts({ jobs, artifacts, now: expiresAt, limit: 10 }),
    ).resolves.toEqual({ scanned: 1, expired: 0, orphanedArtifacts: 1 });
    await expect(jobs.get({ jobId: job.id })).resolves.toMatchObject({
      status: "expired",
      artifactExpiresAt: null,
    });
    await expect(artifacts.deleteExpired({ now: expiresAt, limit: 10 })).resolves.toBe(0);
  });
});
