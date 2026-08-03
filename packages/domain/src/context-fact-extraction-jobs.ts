import { z } from "zod";
import { MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH } from "./context-fact-extraction";
import { JOB_CREATE_OMIT, jobQueueMechanicsShape } from "./job-queue";

export const contextFactExtractionJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "dead_lettered",
]);

export const contextFactExtractionJobSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(MAX_CONTEXT_FACT_EXTRACTION_MESSAGE_LENGTH),
  status: contextFactExtractionJobStatusSchema.default("pending"),
  ...jobQueueMechanicsShape,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createContextFactExtractionJobSchema = contextFactExtractionJobSchema
  .omit(JOB_CREATE_OMIT)
  .extend({
    idempotencyKey: z.string().trim().min(1).max(256),
  });

export type ContextFactExtractionJob = z.infer<typeof contextFactExtractionJobSchema>;
export type ContextFactExtractionJobStatus = z.infer<typeof contextFactExtractionJobStatusSchema>;
export type CreateContextFactExtractionJobInput = z.infer<
  typeof createContextFactExtractionJobSchema
>;

export const claimableContextFactExtractionJobStatuses = [
  "pending",
  "failed",
] as const satisfies ReadonlyArray<ContextFactExtractionJobStatus>;

export const pendingContextFactExtractionJobStatuses = [
  "pending",
  "running",
  "failed",
] as const satisfies ReadonlyArray<ContextFactExtractionJobStatus>;
