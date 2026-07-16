import type { BackgroundJobKind } from "../background-job-deliveries/topics";
import type { BackgroundJobFamilyMechanics } from "./families";

/**
 * Transport metadata a runtime hands the consumer for one delivered message. Kept
 * provider-agnostic so both the web callback and any other consumer describe a message
 * the same way.
 */
export type BackgroundJobQueueConsumerMetadata = {
  topicName?: string;
  messageId?: string;
  deliveryCount?: number;
  consumerGroup?: string;
};

/**
 * The outcome of trying to claim a processor job for one message. `ready` means the job
 * was claimed and may be processed; the other states are safe no-ops (a duplicate, stale,
 * replayed, missing, or terminal message) that the runtime records without processing.
 */
export type BackgroundJobProcessorJobState =
  | { status: "ready" }
  | { status: "not_found" | "terminal" | "not_claimable"; reason?: string };

/**
 * The per-family seam the shared consumer dispatches to: claim the owner-scoped job, then
 * process it. Built from {@link BackgroundJobFamilyMechanics} by
 * {@link createBackgroundJobProcessor} so the claim-translation and terminal-behavior rules
 * live in one place across families.
 */
export type BackgroundJobQueueProcessor = {
  jobKind: BackgroundJobKind;
  claimJob: (input: {
    ownerUserId: string;
    deliveryId: string;
    jobId: string;
  }) => Promise<BackgroundJobProcessorJobState>;
  processJob: (input: {
    ownerUserId: string;
    deliveryId: string;
    jobId: string;
    metadata?: BackgroundJobQueueConsumerMetadata;
  }) => Promise<void>;
};

/** The subset of a family's mechanics the shared claim translation reads. */
type BackgroundJobClaimMechanics = Pick<
  BackgroundJobFamilyMechanics,
  "jobKind" | "noun" | "claimJob" | "getJob" | "processJob"
>;

/**
 * Per-message overrides for testing a processor without the family's default store: the
 * clock plus injectable claim/get/process functions. Derived from the family's own
 * mechanics so the override signatures cannot drift from the real ones. Production
 * consumers pass only `now`.
 */
export type BackgroundJobProcessorOverrides = {
  now?: Date;
} & Partial<Pick<BackgroundJobFamilyMechanics, "claimJob" | "getJob" | "processJob">>;

/**
 * Build the shared {@link BackgroundJobQueueProcessor} for a job family. The claim
 * translation is identical across families:
 *
 * - a successful claim is `ready`;
 * - a claim miss reloads the job and reports `not_found`, `terminal` (completed/skipped),
 *   or `not_claimable` (still running or not yet due) — every branch a safe no-op;
 * - processing rethrows a `failed` outcome so the job's own retry timing (Postgres, not
 *   the queue) governs redelivery.
 *
 * Defining it once here is why adding a family cannot re-diverge duplicate/terminal/
 * not-claimable behavior.
 *
 * Claims are keyed by `jobId` only, not `ownerUserId`: each family's processor loads the
 * job row and derives owner scope from it (jobs run outside a single owner request), so a
 * caller-supplied owner is deliberately not trusted at the claim seam.
 */
export function createBackgroundJobProcessor(
  family: BackgroundJobClaimMechanics,
  overrides: BackgroundJobProcessorOverrides = {},
): BackgroundJobQueueProcessor {
  const claimJob = overrides.claimJob ?? family.claimJob;
  const getJob = overrides.getJob ?? family.getJob;
  const processJob = overrides.processJob ?? family.processJob;

  return {
    jobKind: family.jobKind,
    async claimJob({ jobId }) {
      const claimed = await claimJob({ jobId, now: overrides.now });
      if (claimed) {
        return { status: "ready" as const };
      }

      const job = await getJob(jobId);
      if (!job) {
        return { status: "not_found" as const, reason: `${family.noun} not found.` };
      }
      if (job.status === "completed" || job.status === "skipped") {
        return { status: "terminal" as const, reason: `${family.noun} is ${job.status}.` };
      }

      return { status: "not_claimable" as const, reason: `${family.noun} is ${job.status}.` };
    },
    async processJob({ jobId }) {
      const result = await processJob({ jobId, claim: false });
      if (result.outcome === "failed") {
        throw new Error(result.error ?? result.reason ?? `${family.noun} failed.`);
      }
    },
  };
}
