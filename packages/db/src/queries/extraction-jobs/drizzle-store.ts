import { asc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { extractionJobs, unresolvedPersonMentions } from "../../schema";
import { createDrizzleExtractionJobQueueOps } from "../extraction-job-queue/drizzle-ops";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import type { ExtractionJobStore } from "./types";

export function createDrizzleExtractionJobStore(): ExtractionJobStore {
  const base = createDrizzleMemoryStore();
  const queue = createDrizzleExtractionJobQueueOps(extractionJobs, "Extraction job");

  return {
    ...base,
    getSourceRecordById: queue.getSourceRecordById,
    listSourceRecordPeople: queue.listSourceRecordPeople,
    async listUnresolvedMentions(input) {
      return getDb()
        .select()
        .from(unresolvedPersonMentions)
        .where(eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId))
        .orderBy(asc(unresolvedPersonMentions.createdAt));
    },
    createExtractionJob: queue.createJob,
    findExtractionJobByIdempotencyKey: queue.findJobByIdempotencyKey,
    getExtractionJob: queue.getJob,
    claimExtractionJob: queue.claimJob,
    claimNextExtractionJob: queue.claimNextJob,
    updateExtractionJob: queue.updateJob,
  };
}
