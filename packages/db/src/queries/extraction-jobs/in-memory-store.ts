import { createInMemoryExtractionJobQueue } from "../extraction-job-queue/in-memory-queue";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import type { InMemoryExtractionJobStore } from "./types";

export function createInMemoryExtractionJobStore(): InMemoryExtractionJobStore {
  const base = createInMemoryMemoryStore();
  const queue = createInMemoryExtractionJobQueue("Extraction job");

  return {
    ...base,
    createExtractionJob: queue.createJob,
    findExtractionJobByIdempotencyKey: queue.findJobByIdempotencyKey,
    getExtractionJob: queue.getJob,
    claimExtractionJob: queue.claimJob,
    claimNextExtractionJob: queue.claimNextJob,
    updateExtractionJob: queue.updateJob,
    listExtractionJobs: async () => queue.listJobs(),
  };
}
