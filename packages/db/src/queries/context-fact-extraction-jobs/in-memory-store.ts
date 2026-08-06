import { randomUUID } from "node:crypto";
import {
  type ContextFactExtractionJob,
  type CreateContextFactExtractionJobInput,
  claimableContextFactExtractionJobStatuses,
  contextFactExtractionJobSchema,
  createContextFactExtractionJobSchema,
  pendingContextFactExtractionJobStatuses,
} from "@tendnote/domain";
import { createInMemoryContextFactStore } from "../context-facts/in-memory-store";
import type {
  InMemoryContextFactExtractionJobStore,
  UpdateContextFactExtractionJobInput,
} from "./types";
import { contextFactExtractionJobUpdateValues } from "./update-values";

const CLAIMABLE_STATUSES = new Set<ContextFactExtractionJob["status"]>(
  claimableContextFactExtractionJobStatuses,
);
const PENDING_STATUSES = new Set<ContextFactExtractionJob["status"]>(
  pendingContextFactExtractionJobStatuses,
);
const CONTEXT_FACT_EXTRACTION_JOB_LEASE_MS = 10 * 60 * 1000;

function applyJobUpdate(job: ContextFactExtractionJob, input: UpdateContextFactExtractionJobInput) {
  return contextFactExtractionJobSchema.parse({
    ...job,
    ...contextFactExtractionJobUpdateValues(input),
  });
}

export function createInMemoryContextFactExtractionJobStore(
  seed: ContextFactExtractionJob[] = [],
): InMemoryContextFactExtractionJobStore {
  const base = createInMemoryContextFactStore();
  const jobs = new Map(seed.map((job) => [job.id, contextFactExtractionJobSchema.parse(job)]));

  return {
    ...base,
    async createContextFactExtractionJob(input: CreateContextFactExtractionJobInput) {
      const parsed = createContextFactExtractionJobSchema.parse(input);
      if ([...jobs.values()].some((job) => job.idempotencyKey === parsed.idempotencyKey)) {
        throw new Error("Context Fact extraction job already exists.");
      }
      const now = new Date();
      const job = contextFactExtractionJobSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      jobs.set(job.id, job);
      return job;
    },
    async findContextFactExtractionJobByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getContextFactExtractionJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimContextFactExtractionJob(input) {
      const job = jobs.get(input.jobId);
      const staleRunning =
        job?.status === "running" &&
        (job.claimedAt == null ||
          job.claimedAt.getTime() <= input.now.getTime() - CONTEXT_FACT_EXTRACTION_JOB_LEASE_MS);
      if (!job || !(CLAIMABLE_STATUSES.has(job.status) || staleRunning) || job.runAfter > input.now)
        return null;
      const claimed = contextFactExtractionJobSchema.parse({
        ...job,
        status: "running",
        claimedAt: input.now,
        claimToken: randomUUID(),
        attempts: job.attempts + 1,
        updatedAt: input.now,
      });
      jobs.set(claimed.id, claimed);
      return claimed;
    },
    async claimNextContextFactExtractionJob(input) {
      const next = [...jobs.values()]
        .filter(
          (job) =>
            (CLAIMABLE_STATUSES.has(job.status) ||
              (job.status === "running" &&
                (job.claimedAt == null ||
                  job.claimedAt.getTime() <=
                    input.now.getTime() - CONTEXT_FACT_EXTRACTION_JOB_LEASE_MS))) &&
            job.runAfter <= input.now,
        )
        .sort((left, right) => left.runAfter.getTime() - right.runAfter.getTime())[0];
      if (!next) return null;
      return this.claimContextFactExtractionJob({ jobId: next.id, now: input.now });
    },
    async updateContextFactExtractionJob(input) {
      const job = jobs.get(input.jobId);
      if (!job) return null;
      if (input.expectedClaimToken && job.claimToken !== input.expectedClaimToken) return null;
      const updated = applyJobUpdate(job, input);
      jobs.set(updated.id, updated);
      return updated;
    },
    async countPendingContextFactExtractionJobs(input) {
      return [...jobs.values()].filter(
        (job) => job.ownerUserId === input.ownerUserId && PENDING_STATUSES.has(job.status),
      ).length;
    },
    async listContextFactExtractionJobs() {
      return [...jobs.values()];
    },
  };
}
