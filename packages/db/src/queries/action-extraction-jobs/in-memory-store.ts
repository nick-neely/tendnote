import { randomUUID } from "node:crypto";
import {
  claimableExtractionJobStatuses,
  createExtractionJobSchema,
  type ExtractionJob,
} from "@tendnote/domain";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import type { InMemoryActionExtractionJobStore } from "./types";

const CLAIMABLE_STATUSES = new Set<ExtractionJob["status"]>(claimableExtractionJobStatuses);

/**
 * In-memory action extraction store for the processor tests. It reuses the in-memory
 * General Action lifecycle store (so proposals go through the real review seam, history,
 * and scope rules) and adds an action-job map plus the source-record-scoped read used
 * for dedupe. The action-job map is fully separate from any memory-job map, mirroring
 * the separate physical tables.
 */
export function createInMemoryActionExtractionJobStore(): InMemoryActionExtractionJobStore {
  const base = createInMemoryGeneralActionLifecycleStore();
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
    async listGeneralActionsForSourceRecord(input) {
      const all = await base.listGeneralActionsForOwner({ ownerUserId: input.ownerUserId });
      return all.filter((action) => action.sourceRecordId === input.sourceRecordId);
    },
    async createActionExtractionJob(values) {
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
    async findActionExtractionJobByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getActionExtractionJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimActionExtractionJob(input) {
      const job = jobs.get(input.jobId);

      if (!job || !CLAIMABLE_STATUSES.has(job.status) || job.runAfter > input.now) {
        return null;
      }

      return claim(job, input.now);
    },
    async claimNextActionExtractionJob(input) {
      const next = [...jobs.values()]
        .filter((job) => CLAIMABLE_STATUSES.has(job.status) && job.runAfter <= input.now)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

      if (!next) {
        return null;
      }

      return claim(next, input.now);
    },
    async updateActionExtractionJob(input) {
      const job = jobs.get(input.jobId);

      if (!job) {
        throw new Error("Action extraction job not found.");
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
  };
}
