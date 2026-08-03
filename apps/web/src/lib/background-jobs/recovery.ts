import {
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import { BACKGROUND_JOB_FAMILIES } from "@tendnote/db/queries/background-jobs";
import { recoverStaleSemanticEmbeddingJobs } from "@tendnote/db/queries/semantic-retrieval";
import { classifyBackgroundJobFailure } from "./failure-observability";
import {
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  createVercelBackgroundJobQueueAdapter,
  EMBEDDING_JOB_LEASE_DURATION_MS,
  publishBackgroundJobDelivery,
} from "./queue-runtime";

type JobValidity = "active" | "obsolete";

type DeliveryJobInspector = (delivery: BackgroundJobDelivery) => Promise<JobValidity>;

/** The claim-next + process seam a bounded backfill drives, shared across families. */
type BackfillClaimNextJob = (input: { now?: Date }) => Promise<{ id: string } | null>;
type BackfillProcessJob = (input: { jobId: string; claim: false }) => Promise<{
  outcome: string;
  error?: string;
  reason?: string;
}>;

export type DeliveryRecoveryResult = {
  scanned: number;
  republished: number;
  failed: number;
  abandoned: number;
};

export type ProcessorBackfillResult = {
  scanned: number;
  processed: number;
  failed: number;
};

export type EmbeddingBackfillResult = ProcessorBackfillResult & {
  recovered: number;
};

export type BackgroundJobRecoveryRunResult = {
  deliveries: DeliveryRecoveryResult;
  extraction: ProcessorBackfillResult;
  embedding: EmbeddingBackfillResult;
  actionExtraction: ProcessorBackfillResult;
  contextFactExtraction: ProcessorBackfillResult;
};

/** A backing job is obsolete once it is gone or already terminal. */
function jobValidity(job: { status: string } | null): JobValidity {
  return !job ||
    job.status === "completed" ||
    job.status === "skipped" ||
    job.status === "dead_lettered"
    ? "obsolete"
    : "active";
}

async function inspectDeliveryProcessorJob(delivery: BackgroundJobDelivery): Promise<JobValidity> {
  // Reminder delivery has its own authoritative policy processor. It is intentionally
  // allowed through this generic outbox recovery seam; that processor suppresses stale,
  // revoked, completed, or otherwise ineligible work before contacting Web Push.
  if (delivery.jobKind === "reminder_push") return "active";
  // Registry-driven: each family reports its own job state through the same seam, so
  // recovery no longer re-lists the per-family `getJob` functions by hand.
  return jobValidity(await BACKGROUND_JOB_FAMILIES[delivery.jobKind].getJob(delivery.jobId));
}

export async function recoverBackgroundJobDeliveries(input: {
  limit: number;
  now?: Date;
  store?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  inspectJob?: DeliveryJobInspector;
  logger?: BackgroundJobQueueLogger;
}): Promise<DeliveryRecoveryResult> {
  const now = input.now ?? new Date();
  const store = input.store ?? createDrizzleBackgroundJobDeliveryStore();
  const queue = input.queue ?? createVercelBackgroundJobQueueAdapter();
  const inspectJob = input.inspectJob ?? inspectDeliveryProcessorJob;
  const result: DeliveryRecoveryResult = {
    scanned: 0,
    republished: 0,
    failed: 0,
    abandoned: 0,
  };

  if (input.limit <= 0) {
    return result;
  }

  const dueDeliveries = await store.listDueBackgroundJobDeliveries({
    statuses: ["pending", "publish_failed"],
    now,
    limit: input.limit,
  });

  for (const delivery of dueDeliveries) {
    result.scanned += 1;
    const jobValidity = await inspectJob(delivery);

    if (jobValidity === "obsolete") {
      await store.updateBackgroundJobDelivery({
        ownerUserId: delivery.ownerUserId,
        deliveryId: delivery.id,
        status: "abandoned",
        lastError: "Processor job is terminal or no longer valid.",
      });
      input.logger?.info?.("background_job_recovery.delivery_abandoned", {
        deliveryId: delivery.id,
        jobKind: delivery.jobKind,
        jobId: delivery.jobId,
      });
      result.abandoned += 1;
      continue;
    }

    input.logger?.info?.("background_job_recovery.republish_attempt", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      jobId: delivery.jobId,
    });
    const publishResult = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: delivery.ownerUserId,
      deliveryId: delivery.id,
      now,
      logger: input.logger,
    });

    if (publishResult.ok) {
      result.republished += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}

type ProcessorBackfillInput = {
  limit: number;
  now?: Date;
  claimNextJob?: BackfillClaimNextJob;
  processJob?: BackfillProcessJob;
  logger?: BackgroundJobQueueLogger;
};

type RecoverStaleEmbeddingJobs = typeof recoverStaleSemanticEmbeddingJobs;

/**
 * Bounded queue-less backfill for one job family, defaulting the claim-next/process seam
 * from the registry so each family's wrapper is a one-line binding rather than a copy of
 * the loop. Tests still inject `claimNextJob`/`processJob` to drive the loop directly.
 */
function runFamilyBackfill(
  jobKind: keyof typeof BACKGROUND_JOB_FAMILIES,
  input: ProcessorBackfillInput,
): Promise<ProcessorBackfillResult> {
  const family = BACKGROUND_JOB_FAMILIES[jobKind];
  return runProcessorBackfill({
    jobKind,
    limit: input.limit,
    now: input.now,
    claimNextJob: input.claimNextJob ?? family.claimNextJob,
    processJob: input.processJob ?? family.processJob,
    logger: input.logger,
  });
}

// Named per-family exports kept for the cron route and the recovery assembly's override
// seam; each just binds the shared backfill to its registry key.
export function runExtractionBackfill(
  input: ProcessorBackfillInput,
): Promise<ProcessorBackfillResult> {
  return runFamilyBackfill("extraction", input);
}

export async function runEmbeddingBackfill(
  input: ProcessorBackfillInput & { recoverStaleJobs?: RecoverStaleEmbeddingJobs },
): Promise<EmbeddingBackfillResult> {
  const recoverStaleJobs = input.recoverStaleJobs ?? recoverStaleSemanticEmbeddingJobs;
  const recovery = await recoverStaleJobs({
    now: input.now,
    limit: input.limit,
    leaseDurationMs: EMBEDDING_JOB_LEASE_DURATION_MS,
  });

  for (const job of recovery.jobs) {
    input.logger?.info?.("background_job_recovery.embedding_job_recovered", {
      jobId: job.id,
    });
  }

  return {
    recovered: recovery.jobs.length,
    ...(await runFamilyBackfill("embedding", input)),
  };
}

function runActionExtractionBackfill(
  input: ProcessorBackfillInput,
): Promise<ProcessorBackfillResult> {
  return runFamilyBackfill("action_extraction", input);
}

export function runContextFactExtractionBackfill(
  input: ProcessorBackfillInput,
): Promise<ProcessorBackfillResult> {
  return runFamilyBackfill("context_fact_extraction", input);
}

export async function runBackgroundJobRecovery(input: {
  deliveryLimit: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  actionExtractionBackfillLimit: number;
  contextFactExtractionBackfillLimit?: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries?: typeof recoverBackgroundJobDeliveries;
  backfillExtraction?: typeof runExtractionBackfill;
  backfillEmbedding?: typeof runEmbeddingBackfill;
  backfillActionExtraction?: typeof runActionExtractionBackfill;
  backfillContextFactExtraction?: typeof runContextFactExtractionBackfill;
}): Promise<BackgroundJobRecoveryRunResult> {
  const now = input.now ?? new Date();
  const recoverDeliveries = input.recoverDeliveries ?? recoverBackgroundJobDeliveries;
  const backfillExtraction = input.backfillExtraction ?? runExtractionBackfill;
  const backfillEmbedding = input.backfillEmbedding ?? runEmbeddingBackfill;
  const backfillActionExtraction = input.backfillActionExtraction ?? runActionExtractionBackfill;
  const backfillContextFactExtraction =
    input.backfillContextFactExtraction ?? runContextFactExtractionBackfill;

  const deliveries = await recoverDeliveries({
    limit: input.deliveryLimit,
    now,
    logger: input.logger,
  });
  const extraction = await backfillExtraction({
    limit: input.extractionBackfillLimit,
    now,
    logger: input.logger,
  });
  const embedding = await backfillEmbedding({
    limit: input.embeddingBackfillLimit,
    now,
    logger: input.logger,
  });
  const actionExtraction = await backfillActionExtraction({
    limit: input.actionExtractionBackfillLimit,
    now,
    logger: input.logger,
  });
  const contextFactExtraction = await backfillContextFactExtraction({
    limit: input.contextFactExtractionBackfillLimit ?? 0,
    now,
    logger: input.logger,
  });

  return { deliveries, extraction, embedding, actionExtraction, contextFactExtraction };
}

async function runProcessorBackfill(input: {
  jobKind: "extraction" | "embedding" | "action_extraction" | "context_fact_extraction";
  limit: number;
  now?: Date;
  claimNextJob: BackfillClaimNextJob;
  processJob: BackfillProcessJob;
  logger?: BackgroundJobQueueLogger;
}): Promise<ProcessorBackfillResult> {
  const result: ProcessorBackfillResult = { scanned: 0, processed: 0, failed: 0 };

  for (let index = 0; index < input.limit; index += 1) {
    const job = await input.claimNextJob({ now: input.now });
    if (!job) {
      break;
    }

    result.scanned += 1;
    const processResult = await input.processJob({ jobId: job.id, claim: false });

    if (processResult.outcome === "failed") {
      result.failed += 1;
      input.logger?.error?.("background_job_recovery.processor_failed", {
        jobKind: input.jobKind,
        jobId: job.id,
        errorCode: classifyBackgroundJobFailure(
          processResult.error ?? processResult.reason ?? "Background job failed.",
        ),
      });
    } else {
      result.processed += 1;
    }
    input.logger?.info?.("background_job_recovery.processor_backfill", {
      jobKind: input.jobKind,
      jobId: job.id,
      outcome: processResult.outcome,
    });
  }

  return result;
}
