import { randomUUID } from "node:crypto";
import {
  type CreateExtractionJobInput,
  claimableExtractionJobStatuses,
  createExtractionJobSchema,
  type ExtractionJob,
} from "@tendnote/domain";

const CLAIMABLE_STATUSES = new Set<ExtractionJob["status"]>(claimableExtractionJobStatuses);

export type UpdateJobFields = {
  jobId: string;
  status?: ExtractionJob["status"];
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

/**
 * Apply a partial job update onto an existing in-memory job row, honoring the "present key
 * clears, absent key preserves" nullability contract for `claimedAt`/`completedAt`. Shared
 * by every Map-backed Postgres-owned job queue (extraction, action extraction, embedding)
 * so the merge semantics stay identical; the cast is confined here because the input's
 * status is the caller's job-specific enum.
 */
export function applyJobUpdateFields<J extends { updatedAt: Date }>(
  job: J,
  input: {
    status?: string;
    lastError?: string | null;
    runAfter?: Date;
    claimedAt?: Date | null;
    completedAt?: Date | null;
  },
): J {
  return {
    ...job,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
    ...("claimedAt" in input ? { claimedAt: input.claimedAt } : {}),
    ...("completedAt" in input ? { completedAt: input.completedAt } : {}),
    updatedAt: new Date(),
  } as J;
}

/**
 * In-memory Postgres-owned extraction job queue: a `Map`-backed job store with the exact
 * create/find/get/claim/update/claim-next semantics shared by memory extraction and action
 * extraction. Both pipelines keep separate physical tables (ADR 0018, #183), so each store
 * owns its own queue instance — this only shares the mechanical job-lifecycle plumbing, not
 * job state, and is parameterized by the human-readable label used in the not-found error.
 */
export function createInMemoryExtractionJobQueue(notFoundLabel: string) {
  const jobs = new Map<string, ExtractionJob>();

  function claim(job: ExtractionJob, now: Date): ExtractionJob {
    const claimed: ExtractionJob = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      claimedAt: now,
      updatedAt: now,
    };

    jobs.set(claimed.id, claimed);

    return claimed;
  }

  return {
    async createJob(values: CreateExtractionJobInput): Promise<ExtractionJob> {
      const parsed = createExtractionJobSchema.parse(values);
      const now = new Date();
      const job: ExtractionJob = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      jobs.set(job.id, job);

      return job;
    },
    async findJobByIdempotencyKey(idempotencyKey: string): Promise<ExtractionJob | null> {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getJob(jobId: string): Promise<ExtractionJob | null> {
      return jobs.get(jobId) ?? null;
    },
    async claimJob(input: { jobId: string; now: Date }): Promise<ExtractionJob | null> {
      const job = jobs.get(input.jobId);

      if (!job || !CLAIMABLE_STATUSES.has(job.status) || job.runAfter > input.now) {
        return null;
      }

      return claim(job, input.now);
    },
    async claimNextJob(input: { now: Date }): Promise<ExtractionJob | null> {
      const next = [...jobs.values()]
        .filter((job) => CLAIMABLE_STATUSES.has(job.status) && job.runAfter <= input.now)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

      if (!next) {
        return null;
      }

      return claim(next, input.now);
    },
    async updateJob(input: UpdateJobFields): Promise<ExtractionJob> {
      const job = jobs.get(input.jobId);

      if (!job) {
        throw new Error(`${notFoundLabel} not found.`);
      }

      const updated = applyJobUpdateFields(job, input);

      jobs.set(updated.id, updated);

      return updated;
    },
    listJobs(): ExtractionJob[] {
      return [...jobs.values()];
    },
  };
}
