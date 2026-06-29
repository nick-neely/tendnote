import {
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  claimNextExtractionJob,
  getExtractionJob,
  processExtractionJob,
} from "@tendnote/db/queries/extraction-jobs";
import {
  claimNextSemanticEmbeddingJob,
  getSemanticEmbeddingJob,
  processSemanticEmbeddingJob,
} from "@tendnote/db/queries/semantic-retrieval";
import {
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  createVercelBackgroundJobQueueAdapter,
  publishBackgroundJobDelivery,
} from "./queue-runtime";

type JobValidity = "active" | "obsolete";

type DeliveryJobInspector = (delivery: BackgroundJobDelivery) => Promise<JobValidity>;

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

export type BackgroundJobRecoveryRunResult = {
  deliveries: DeliveryRecoveryResult;
  extraction: ProcessorBackfillResult;
  embedding: ProcessorBackfillResult;
};

export async function inspectDeliveryProcessorJob(
  delivery: BackgroundJobDelivery,
): Promise<JobValidity> {
  if (delivery.jobKind === "extraction") {
    const job = await getExtractionJob(delivery.jobId);
    return !job || job.status === "completed" || job.status === "skipped" ? "obsolete" : "active";
  }

  const job = await getSemanticEmbeddingJob(delivery.jobId);
  return !job || job.status === "completed" || job.status === "skipped" ? "obsolete" : "active";
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

export async function runExtractionBackfill(input: {
  limit: number;
  now?: Date;
  claimNextJob?: typeof claimNextExtractionJob;
  processJob?: typeof processExtractionJob;
  logger?: BackgroundJobQueueLogger;
}): Promise<ProcessorBackfillResult> {
  return runProcessorBackfill({
    jobKind: "extraction",
    limit: input.limit,
    now: input.now,
    claimNextJob: input.claimNextJob ?? claimNextExtractionJob,
    processJob: input.processJob ?? processExtractionJob,
    logger: input.logger,
  });
}

export async function runEmbeddingBackfill(input: {
  limit: number;
  now?: Date;
  claimNextJob?: typeof claimNextSemanticEmbeddingJob;
  processJob?: typeof processSemanticEmbeddingJob;
  logger?: BackgroundJobQueueLogger;
}): Promise<ProcessorBackfillResult> {
  return runProcessorBackfill({
    jobKind: "embedding",
    limit: input.limit,
    now: input.now,
    claimNextJob: input.claimNextJob ?? claimNextSemanticEmbeddingJob,
    processJob: input.processJob ?? processSemanticEmbeddingJob,
    logger: input.logger,
  });
}

export async function runBackgroundJobRecovery(input: {
  deliveryLimit: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries?: typeof recoverBackgroundJobDeliveries;
  backfillExtraction?: typeof runExtractionBackfill;
  backfillEmbedding?: typeof runEmbeddingBackfill;
}): Promise<BackgroundJobRecoveryRunResult> {
  const now = input.now ?? new Date();
  const recoverDeliveries = input.recoverDeliveries ?? recoverBackgroundJobDeliveries;
  const backfillExtraction = input.backfillExtraction ?? runExtractionBackfill;
  const backfillEmbedding = input.backfillEmbedding ?? runEmbeddingBackfill;

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

  return { deliveries, extraction, embedding };
}

async function runProcessorBackfill(input: {
  jobKind: "extraction" | "embedding";
  limit: number;
  now?: Date;
  claimNextJob: (input?: { now?: Date }) => Promise<{ id: string } | null>;
  processJob: (input: { jobId: string; claim: false }) => Promise<{ outcome: string }>;
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
