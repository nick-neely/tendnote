import { z } from "zod";

/**
 * The fields every durable background job in Tendnote carries, regardless of what it
 * does: retry accounting, the idempotency key that makes re-enqueueing safe, and the
 * claim/complete timestamps a worker moves through.
 *
 * Extracted so the extraction-job and embedding-job schemas declare them once. They had
 * drifted into being character-for-character identical, which is exactly the point at
 * which two copies become one thing with two names — and a fix applied to one would
 * silently miss the other.
 *
 * Each queue still owns its own `status` enum and its own record-identity fields; only
 * the queue mechanics are shared.
 */
export const jobQueueMechanicsShape = {
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  runAfter: z.date(),
  claimedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
};

/** The keys a create-input schema omits: the store assigns id and timestamps. */
export const JOB_CREATE_OMIT = {
  id: true,
  createdAt: true,
  updatedAt: true,
} as const;
