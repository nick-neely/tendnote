import { randomUUID } from "node:crypto";
import {
  claimableExtractionJobStatuses,
  createExtractionJobSchema,
  type ExtractionJob,
} from "@tendnote/domain";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import type { InMemoryExtractionJobStore } from "./types";

const CLAIMABLE_STATUSES = new Set<ExtractionJob["status"]>(claimableExtractionJobStatuses);

export function createInMemoryExtractionJobStore(): InMemoryExtractionJobStore {
  const base = createInMemoryMemoryStore();
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
    ...base,
    async createExtractionJob(values) {
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
    async findExtractionJobByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getExtractionJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimExtractionJob(input) {
      const job = jobs.get(input.jobId);

      if (!job || !CLAIMABLE_STATUSES.has(job.status) || job.runAfter > input.now) {
        return null;
      }

      return claim(job, input.now);
    },
    async claimNextExtractionJob(input) {
      const next = [...jobs.values()]
        .filter((job) => CLAIMABLE_STATUSES.has(job.status) && job.runAfter <= input.now)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

      if (!next) {
        return null;
      }

      return claim(next, input.now);
    },
    async updateExtractionJob(input) {
      const job = jobs.get(input.jobId);

      if (!job) {
        throw new Error("Extraction job not found.");
      }

      const updated: ExtractionJob = {
        ...job,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
        ...("claimedAt" in input ? { claimedAt: input.claimedAt } : {}),
        ...("completedAt" in input ? { completedAt: input.completedAt } : {}),
        updatedAt: new Date(),
      };

      jobs.set(updated.id, updated);

      return updated;
    },
    async listExtractionJobs() {
      return [...jobs.values()];
    },
  };
}
