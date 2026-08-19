import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryOwnerDataExportArtifactStore,
  createInMemoryOwnerDataExportJobStore,
} from "./in-memory-store";
import { enqueueAndTriggerOwnerDataExportJob, processOwnerDataExportJob } from "./processor";

describe("owner data export jobs", () => {
  it("keeps enqueue idempotent and processes a durable artifact exactly once", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore();
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

  it("records a processing failure as retryable state and recovers it after runAfter", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore();
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
    const completed = await processOwnerDataExportJob({
      jobId: job.id,
      jobs,
      artifacts,
      now: new Date(now.getTime() + 6 * 60_000),
      claim: false,
      generate: vi.fn().mockResolvedValue({ bytes: new Uint8Array([9]), manifest: {} as never }),
    });
    expect(completed.outcome).toBe("completed");
  });

  it("refuses cross-owner artifact reads and removes expired bytes", async () => {
    const artifacts = createInMemoryOwnerDataExportArtifactStore();
    const expiresAt = new Date("2026-08-20T12:00:00.000Z");
    await artifacts.put({
      jobId: "job-1",
      ownerUserId: "owner-1",
      bytes: new Uint8Array([7]),
      expiresAt,
    });
    await expect(
      artifacts.get({ jobId: "job-1", ownerUserId: "owner-2", now: new Date("2026-08-19") }),
    ).resolves.toBeNull();
    await expect(
      artifacts.get({ jobId: "job-1", ownerUserId: "owner-1", now: expiresAt }),
    ).resolves.toBeNull();
    await expect(artifacts.deleteExpired({ now: expiresAt, limit: 10 })).resolves.toBe(1);
  });
});
