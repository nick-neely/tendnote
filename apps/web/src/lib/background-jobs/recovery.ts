import {
  type AuditLogRetentionSweepResult,
  createDrizzleAuditLogRetentionStore,
  runAuditLogRetentionSweep,
} from "@tendnote/db/queries/audit-retention";
import {
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import { BACKGROUND_JOB_FAMILIES } from "@tendnote/db/queries/background-jobs";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import {
  createDrizzleHouseholdPurgeStore,
  type HouseholdPurgeSweepResult,
  runHouseholdPurgeSweep,
} from "@tendnote/db/queries/households";
import { recoverStaleSemanticEmbeddingJobs } from "@tendnote/db/queries/semantic-retrieval";
import { reconcileAffectedScopes } from "@/lib/cache/reconcile-affected-scopes";
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
type BackfillClaimNextJob = (input: {
  now?: Date;
}) => Promise<{ id: string; claimToken?: string } | null>;
type BackfillProcessJob = (input: { jobId: string; claim: false; claimToken?: string }) => Promise<{
  outcome: string;
  error?: string;
  reason?: string;
  affectedScopes?: AffectedScope[];
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
  householdPurge: HouseholdPurgeSweepResult;
  auditRetention: AuditLogRetentionSweepResult;
};

/** A backing job is obsolete once it is gone or already terminal. */
const TERMINAL_JOB_STATUSES = new Set(["completed", "skipped", "dead_lettered"]);

function jobValidity(job: { status: string } | null): JobValidity {
  return job && !TERMINAL_JOB_STATUSES.has(job.status) ? "active" : "obsolete";
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
  onProcessed?: (result: { affectedScopes?: AffectedScope[] }) => void | Promise<void>;
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
    onProcessed: input.onProcessed,
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

function runContextFactExtractionBackfill(
  input: ProcessorBackfillInput,
): Promise<ProcessorBackfillResult> {
  return runFamilyBackfill("context_fact_extraction", {
    ...input,
    onProcessed: async (result) => {
      if (result.affectedScopes?.length) {
        reconcileAffectedScopes(result.affectedScopes, { origin: "background" });
      }
      await input.onProcessed?.(result);
    },
  });
}

/**
 * Closes the household recovery window for the households whose thirty days are
 * up, disposing of the workspace's own records and leaving the minimized
 * non-content tombstone (#391).
 *
 * Bounded like every other family here, and after the retryable recovery work:
 * it is the only irreversible family in this part of the pass, so its own
 * budget keeps a slow household from consuming the audit-retention budget.
 */
function purgeDueDissolvedHouseholds(input: {
  limit: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
}): Promise<HouseholdPurgeSweepResult> {
  return runHouseholdPurgeSweep({
    limit: input.limit,
    store: createDrizzleHouseholdPurgeStore(),
    ...(input.now ? { now: input.now } : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

/**
 * Keeps the internal audit trail bounded on the same ten-minute recovery pass.
 * It runs in a separate final stage so a failure in any earlier recovery stage
 * cannot prevent retention from getting its own attempt and budget.
 */
function retainExpiredAuditLogEntries(input: {
  limit: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
}): Promise<AuditLogRetentionSweepResult> {
  return runAuditLogRetentionSweep({
    limit: input.limit,
    store: createDrizzleAuditLogRetentionStore(),
    ...(input.now ? { now: input.now } : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

function reportSecondaryAuditRetentionFailure(input: { logger?: BackgroundJobQueueLogger }): void {
  try {
    input.logger?.error?.("background_job_recovery.audit_retention_failed", {
      stage: "audit_retention",
      reason: "retention_failed_after_recovery_stage",
    });
  } catch {
    // A diagnostic logger must never replace the recovery failure being reported.
  }
}

async function runRetryableBackgroundRecovery(input: {
  deliveryLimit: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  actionExtractionBackfillLimit: number;
  contextFactExtractionBackfillLimit: number;
  householdPurgeLimit: number;
  now: Date;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries: typeof recoverBackgroundJobDeliveries;
  backfillExtraction: typeof runExtractionBackfill;
  backfillEmbedding: typeof runEmbeddingBackfill;
  backfillActionExtraction: typeof runActionExtractionBackfill;
  backfillContextFactExtraction: typeof runContextFactExtractionBackfill;
  purgeDissolvedHouseholds: typeof purgeDueDissolvedHouseholds;
}): Promise<Omit<BackgroundJobRecoveryRunResult, "auditRetention">> {
  const deliveries = await input.recoverDeliveries({
    limit: input.deliveryLimit,
    now: input.now,
    logger: input.logger,
  });
  const extraction = await input.backfillExtraction({
    limit: input.extractionBackfillLimit,
    now: input.now,
    logger: input.logger,
  });
  const embedding = await input.backfillEmbedding({
    limit: input.embeddingBackfillLimit,
    now: input.now,
    logger: input.logger,
  });
  const actionExtraction = await input.backfillActionExtraction({
    limit: input.actionExtractionBackfillLimit,
    now: input.now,
    logger: input.logger,
  });
  const contextFactExtraction = await input.backfillContextFactExtraction({
    limit: input.contextFactExtractionBackfillLimit,
    now: input.now,
    logger: input.logger,
  });
  const householdPurge = await input.purgeDissolvedHouseholds({
    limit: input.householdPurgeLimit,
    now: input.now,
    ...(input.logger ? { logger: input.logger } : {}),
  });

  return {
    deliveries,
    extraction,
    embedding,
    actionExtraction,
    contextFactExtraction,
    householdPurge,
  };
}

type BackgroundJobRecoveryInput = {
  deliveryLimit: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  actionExtractionBackfillLimit: number;
  contextFactExtractionBackfillLimit?: number;
  householdPurgeLimit?: number;
  auditRetentionLimit?: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries?: typeof recoverBackgroundJobDeliveries;
  backfillExtraction?: typeof runExtractionBackfill;
  backfillEmbedding?: typeof runEmbeddingBackfill;
  backfillActionExtraction?: typeof runActionExtractionBackfill;
  backfillContextFactExtraction?: typeof runContextFactExtractionBackfill;
  purgeDissolvedHouseholds?: typeof purgeDueDissolvedHouseholds;
  retainAuditLog?: typeof retainExpiredAuditLogEntries;
};

type BackgroundJobRecoveryDependencies = {
  recoverDeliveries: typeof recoverBackgroundJobDeliveries;
  backfillExtraction: typeof runExtractionBackfill;
  backfillEmbedding: typeof runEmbeddingBackfill;
  backfillActionExtraction: typeof runActionExtractionBackfill;
  backfillContextFactExtraction: typeof runContextFactExtractionBackfill;
  purgeDissolvedHouseholds: typeof purgeDueDissolvedHouseholds;
  retainAuditLog: typeof retainExpiredAuditLogEntries;
};

function resolveBackgroundJobRecoveryDependencies(
  input: BackgroundJobRecoveryInput,
): BackgroundJobRecoveryDependencies {
  return {
    recoverDeliveries: input.recoverDeliveries ?? recoverBackgroundJobDeliveries,
    backfillExtraction: input.backfillExtraction ?? runExtractionBackfill,
    backfillEmbedding: input.backfillEmbedding ?? runEmbeddingBackfill,
    backfillActionExtraction: input.backfillActionExtraction ?? runActionExtractionBackfill,
    backfillContextFactExtraction:
      input.backfillContextFactExtraction ?? runContextFactExtractionBackfill,
    purgeDissolvedHouseholds: input.purgeDissolvedHouseholds ?? purgeDueDissolvedHouseholds,
    retainAuditLog: input.retainAuditLog ?? retainExpiredAuditLogEntries,
  };
}

type BackgroundJobRecoveryAttempt =
  | {
      ok: true;
      result: Omit<BackgroundJobRecoveryRunResult, "auditRetention">;
    }
  | { ok: false; error: unknown };

async function attemptRetryableBackgroundRecovery(input: {
  recovery: Parameters<typeof runRetryableBackgroundRecovery>[0];
}): Promise<BackgroundJobRecoveryAttempt> {
  try {
    return {
      ok: true,
      result: await runRetryableBackgroundRecovery(input.recovery),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function runAuditRetentionAfterRecovery(input: {
  limit: number;
  now: Date;
  logger?: BackgroundJobQueueLogger;
  retainAuditLog: typeof retainExpiredAuditLogEntries;
  recoveryFailed: boolean;
}): Promise<AuditLogRetentionSweepResult | undefined> {
  try {
    return await input.retainAuditLog({
      limit: input.limit,
      now: input.now,
      ...(input.logger ? { logger: input.logger } : {}),
    });
  } catch (error) {
    if (!input.recoveryFailed) throw error;
    reportSecondaryAuditRetentionFailure({ logger: input.logger });
    return undefined;
  }
}

async function runBackgroundJobRecoveryPass(
  input: BackgroundJobRecoveryInput,
  now: Date,
  dependencies: BackgroundJobRecoveryDependencies,
): Promise<BackgroundJobRecoveryRunResult> {
  const recovery = await attemptRetryableBackgroundRecovery({
    recovery: {
      deliveryLimit: input.deliveryLimit,
      extractionBackfillLimit: input.extractionBackfillLimit,
      embeddingBackfillLimit: input.embeddingBackfillLimit,
      actionExtractionBackfillLimit: input.actionExtractionBackfillLimit,
      contextFactExtractionBackfillLimit: input.contextFactExtractionBackfillLimit ?? 0,
      householdPurgeLimit: input.householdPurgeLimit ?? 0,
      now,
      logger: input.logger,
      recoverDeliveries: dependencies.recoverDeliveries,
      backfillExtraction: dependencies.backfillExtraction,
      backfillEmbedding: dependencies.backfillEmbedding,
      backfillActionExtraction: dependencies.backfillActionExtraction,
      backfillContextFactExtraction: dependencies.backfillContextFactExtraction,
      purgeDissolvedHouseholds: dependencies.purgeDissolvedHouseholds,
    },
  });
  const auditRetention = await runAuditRetentionAfterRecovery({
    limit: input.auditRetentionLimit ?? 0,
    now,
    logger: input.logger,
    retainAuditLog: dependencies.retainAuditLog,
    recoveryFailed: !recovery.ok,
  });

  if (!recovery.ok) throw recovery.error;
  if (!auditRetention) {
    throw new Error("Background recovery completed without a retention result.");
  }

  return { ...recovery.result, auditRetention };
}

export async function runBackgroundJobRecovery(
  input: BackgroundJobRecoveryInput,
): Promise<BackgroundJobRecoveryRunResult> {
  return runBackgroundJobRecoveryPass(
    input,
    input.now ?? new Date(),
    resolveBackgroundJobRecoveryDependencies(input),
  );
}

async function runProcessorBackfill(input: {
  jobKind: "extraction" | "embedding" | "action_extraction" | "context_fact_extraction";
  limit: number;
  now?: Date;
  claimNextJob: BackfillClaimNextJob;
  processJob: BackfillProcessJob;
  logger?: BackgroundJobQueueLogger;
  onProcessed?: (result: { affectedScopes?: AffectedScope[] }) => void | Promise<void>;
}): Promise<ProcessorBackfillResult> {
  const result: ProcessorBackfillResult = { scanned: 0, processed: 0, failed: 0 };

  for (let index = 0; index < input.limit; index += 1) {
    const job = await input.claimNextJob({ now: input.now });
    if (!job) {
      break;
    }

    result.scanned += 1;
    const processResult = await input.processJob({
      jobId: job.id,
      claim: false,
      ...(job.claimToken ? { claimToken: job.claimToken } : {}),
    });
    await input.onProcessed?.(processResult);

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
