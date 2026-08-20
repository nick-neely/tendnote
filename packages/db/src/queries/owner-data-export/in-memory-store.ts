import { randomUUID } from "node:crypto";
import type {
  EnqueueOwnerDataExportJobInput,
  OwnerDataExportArtifact,
  OwnerDataExportArtifactStore,
  OwnerDataExportJob,
  OwnerDataExportJobStore,
} from "./types";

const DEFAULT_LEASE_DURATION_MS = 10 * 60 * 1000;

function scrubError(error: string) {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}

function cloneJob(job: OwnerDataExportJob): OwnerDataExportJob {
  return { ...job };
}

function createJob(input: EnqueueOwnerDataExportJobInput): OwnerDataExportJob {
  const now = input.now ?? new Date();
  return {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey:
      input.idempotencyKey ?? `owner-data-export:${input.ownerUserId}:${randomUUID()}`,
    runAfter: now,
    claimedAt: null,
    claimToken: null,
    completedAt: null,
    artifactExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInMemoryOwnerDataExportJobStore(): OwnerDataExportJobStore {
  const jobs = new Map<string, OwnerDataExportJob>();
  const idsByIdempotencyKey = new Map<string, string>();

  function scopedIdempotencyKey(ownerUserId: string, idempotencyKey: string) {
    return `${ownerUserId}\u0000${idempotencyKey}`;
  }

  function update(job: OwnerDataExportJob, patch: Partial<OwnerDataExportJob>) {
    const updated = { ...job, ...patch, updatedAt: new Date() };
    jobs.set(updated.id, updated);
    return cloneJob(updated);
  }

  function claimable(job: OwnerDataExportJob, now: Date, leaseDurationMs: number) {
    if ((job.status === "pending" || job.status === "failed") && job.runAfter <= now) {
      return true;
    }
    return (
      job.status === "running" &&
      job.claimedAt !== null &&
      job.claimedAt.getTime() + leaseDurationMs <= now.getTime()
    );
  }

  function claimJob(job: OwnerDataExportJob, now: Date, leaseDurationMs: number) {
    if (!claimable(job, now, leaseDurationMs)) return null;
    return update(job, {
      status: "running",
      attempts: job.attempts + 1,
      claimedAt: now,
      claimToken: randomUUID(),
      lastError: null,
    });
  }

  return {
    async enqueue(input) {
      const idempotencyKey = input.idempotencyKey;
      if (idempotencyKey) {
        const existingId = idsByIdempotencyKey.get(
          scopedIdempotencyKey(input.ownerUserId, idempotencyKey),
        );
        const existing = existingId ? jobs.get(existingId) : undefined;
        if (existing) return { job: cloneJob(existing), created: false };
      }

      const job = createJob(input);
      jobs.set(job.id, job);
      idsByIdempotencyKey.set(scopedIdempotencyKey(job.ownerUserId, job.idempotencyKey), job.id);
      return { job: cloneJob(job), created: true };
    },
    async get(input) {
      const job = jobs.get(input.jobId);
      if (!job || (input.ownerUserId && job.ownerUserId !== input.ownerUserId)) return null;
      return cloneJob(job);
    },
    async getLatestForOwner(input) {
      const latest =
        [...jobs.values()]
          .filter((job) => job.ownerUserId === input.ownerUserId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
      return latest ? cloneJob(latest) : null;
    },
    async claim(input) {
      const job = jobs.get(input.jobId);
      if (!job) return null;
      return claimJob(
        job,
        input.now ?? new Date(),
        input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
      );
    },
    async claimNext(input) {
      const now = input.now ?? new Date();
      const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      const next = [...jobs.values()]
        .filter((job) => claimable(job, now, leaseDurationMs))
        .sort((left, right) => left.runAfter.getTime() - right.runAfter.getTime())[0];
      return next ? claimJob(next, now, leaseDurationMs) : null;
    },
    async markCompleted(input) {
      const job = jobs.get(input.jobId);
      if (job?.status !== "running" || job.claimToken !== input.expectedClaimToken) {
        return null;
      }
      return update(job, {
        status: "completed",
        completedAt: input.completedAt ?? new Date(),
        artifactExpiresAt: input.artifactExpiresAt,
        claimedAt: null,
        claimToken: null,
        lastError: null,
      });
    },
    async markFailed(input) {
      const job = jobs.get(input.jobId);
      if (job?.status !== "running" || job.claimToken !== input.expectedClaimToken) {
        return null;
      }
      return update(job, {
        status: "failed",
        lastError: scrubError(input.error),
        runAfter: input.runAfter,
        claimedAt: null,
        claimToken: null,
      });
    },
    async markExpired(input) {
      const job = jobs.get(input.jobId);
      if (!job) return null;
      const now = input.now ?? new Date();
      if (
        (job.status !== "completed" && job.status !== "expired") ||
        !job.artifactExpiresAt ||
        job.artifactExpiresAt > now
      ) {
        return null;
      }
      if (job.status === "expired") return cloneJob(job);
      return update(job, { status: "expired" });
    },
    async markArtifactDeleted(input) {
      const job = jobs.get(input.jobId);
      if (job?.status !== "expired") return null;
      return update(job, { artifactExpiresAt: null });
    },
    async listExpired(input) {
      const now = input.now ?? new Date();
      return [...jobs.values()]
        .filter(
          (job) =>
            (job.status === "completed" || job.status === "expired") &&
            job.artifactExpiresAt !== null &&
            job.artifactExpiresAt <= now,
        )
        .sort(
          (left, right) =>
            (left.artifactExpiresAt?.getTime() ?? 0) - (right.artifactExpiresAt?.getTime() ?? 0),
        )
        .slice(0, input.limit)
        .map(cloneJob);
    },
  };
}

export function createInMemoryOwnerDataExportArtifactStore(): OwnerDataExportArtifactStore {
  const artifacts = new Map<string, OwnerDataExportArtifact>();
  return {
    async put(input) {
      const now = new Date();
      const artifact: OwnerDataExportArtifact = {
        jobId: input.jobId,
        ownerUserId: input.ownerUserId,
        bytes: new Uint8Array(input.bytes),
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      artifacts.set(input.jobId, artifact);
      return { ...artifact, bytes: new Uint8Array(artifact.bytes) };
    },
    async get(input) {
      const artifact = artifacts.get(input.jobId);
      const now = input.now ?? new Date();
      if (
        !artifact ||
        artifact.ownerUserId !== input.ownerUserId ||
        artifact.expiresAt.getTime() <= now.getTime()
      ) {
        return null;
      }
      return { ...artifact, bytes: new Uint8Array(artifact.bytes) };
    },
    async delete(input) {
      artifacts.delete(input.jobId);
    },
    async deleteExpired(input) {
      const now = input.now ?? new Date();
      let deleted = 0;
      for (const [jobId, artifact] of artifacts) {
        if (artifact.expiresAt <= now && deleted < input.limit) {
          artifacts.delete(jobId);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}
