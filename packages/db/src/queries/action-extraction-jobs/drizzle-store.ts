import { generalActionSchema } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { actionExtractionJobs, generalActions } from "../../schema";
import {
  createDrizzleExtractionJobQueueOps,
  type ExtractionJobQueueTable,
} from "../extraction-job-queue/drizzle-ops";
import { createDrizzleGeneralActionAreaStore } from "../general-action-areas/drizzle-store";
import { createDrizzleGeneralActionLifecycleStore } from "../general-actions/drizzle-store";
import type { ActionExtractionJobStore } from "./types";

/**
 * Drizzle-backed action extraction store: the General Action lifecycle store (so
 * proposals go through the real review seam, scope, and history) plus the system-level
 * reads the async processor needs and the Postgres-owned action-job lifecycle over the
 * separate `action_extraction_jobs` table. Like memory extraction, it loads a source
 * record by id and derives owner scope from the loaded record rather than trusting a
 * caller-supplied owner id.
 */
export function createDrizzleActionExtractionJobStore(): ActionExtractionJobStore {
  const base = createDrizzleGeneralActionLifecycleStore();
  const areas = createDrizzleGeneralActionAreaStore();
  // `action_extraction_jobs` is column-identical to `extraction_jobs` but a distinct
  // Drizzle table type; the shared queue ops run against the concrete table object passed.
  const queue = createDrizzleExtractionJobQueueOps(
    actionExtractionJobs as unknown as ExtractionJobQueueTable,
    "Action extraction job",
  );

  return {
    ...base,
    listAreasForOwner: areas.listAreasForOwner,
    getSourceRecordById: queue.getSourceRecordById,
    listSourceRecordPeople: queue.listSourceRecordPeople,
    async listGeneralActionsForSourceRecord(input) {
      const rows = await getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.ownerUserId, input.ownerUserId),
            eq(generalActions.sourceRecordId, input.sourceRecordId),
          ),
        );

      return rows.map((row) => generalActionSchema.parse(row));
    },
    createActionExtractionJob: queue.createJob,
    findActionExtractionJobByIdempotencyKey: queue.findJobByIdempotencyKey,
    getActionExtractionJob: queue.getJob,
    claimActionExtractionJob: queue.claimJob,
    claimNextActionExtractionJob: queue.claimNextJob,
    updateActionExtractionJob: queue.updateJob,
  };
}
