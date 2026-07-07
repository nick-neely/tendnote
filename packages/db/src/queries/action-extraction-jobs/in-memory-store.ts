import { createInMemoryExtractionJobQueue } from "../extraction-job-queue/in-memory-queue";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import type { InMemoryActionExtractionJobStore } from "./types";

/**
 * In-memory action extraction store for the processor tests. It reuses the in-memory
 * General Action lifecycle store (so proposals go through the real review seam, history,
 * and scope rules) and adds an action-job queue plus the source-record-scoped read used
 * for dedupe. The action-job queue is fully separate from any memory-job queue, mirroring
 * the separate physical tables.
 */
export function createInMemoryActionExtractionJobStore(): InMemoryActionExtractionJobStore {
  const base = createInMemoryGeneralActionLifecycleStore();
  const queue = createInMemoryExtractionJobQueue("Action extraction job");

  return {
    ...base,
    async listGeneralActionsForSourceRecord(input) {
      const all = await base.listGeneralActionsForOwner({ ownerUserId: input.ownerUserId });
      return all.filter((action) => action.sourceRecordId === input.sourceRecordId);
    },
    createActionExtractionJob: queue.createJob,
    findActionExtractionJobByIdempotencyKey: queue.findJobByIdempotencyKey,
    getActionExtractionJob: queue.getJob,
    claimActionExtractionJob: queue.claimJob,
    claimNextActionExtractionJob: queue.claimNextJob,
    updateActionExtractionJob: queue.updateJob,
  };
}
