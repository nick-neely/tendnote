import {
  type AccountDeletionSweepResult,
  blobRecoveryJournal,
  runAccountDeletionSweep,
} from "@tendnote/db/queries/account-deletion";
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
import {
  expireOwnerDataExportArtifacts,
  type OwnerDataExportJobStore,
} from "@tendnote/db/queries/owner-data-export";
import {
  createDrizzleReminderStore,
  type LostReminderWakeupResult,
  type ReminderStore,
  recoverLostReminderWakeups,
  reminderDeliveryPublishesAhead,
  reminderDeliveryWakeupTime,
} from "@tendnote/db/queries/reminders";
import { recoverStaleSemanticEmbeddingJobs } from "@tendnote/db/queries/semantic-retrieval";
import { findLatestServiceWideHoldLift } from "@tendnote/db/queries/service-wide-hold";
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
  /** Reminder wake-ups the queue would never deliver, re-armed from job state. */
  lostReminderWakeups?: LostReminderWakeupResult;
};

type ReminderWakeupStore = Pick<
  ReminderStore,
  "getDeliveryJob" | "listOverdueDeliveryJobs" | "suppressStaleDeliveryJob" | "appendAuditEntry"
>;

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
  ownerDataExport: ProcessorBackfillResult;
  accountDeletion: AccountDeletionSweepResult;
  householdPurge: HouseholdPurgeSweepResult;
  auditRetention: AuditLogRetentionSweepResult;
};

/** A backing job is obsolete once it is gone or already terminal. */
const TERMINAL_JOB_STATUSES = new Set(["completed", "skipped", "dead_lettered", "expired"]);

function jobValidity(job: { status: string } | null): JobValidity {
  return job && !TERMINAL_JOB_STATUSES.has(job.status) ? "active" : "obsolete";
}

async function inspectDeliveryProcessorJob(delivery: BackgroundJobDelivery): Promise<JobValidity> {
  // Reminder deliveries never reach here; see `reminderWakeupTarget`.
  if (delivery.jobKind === "reminder_push") return "active";
  // Registry-driven: each family reports its own job state through the same seam, so
  // recovery no longer re-lists the per-family `getJob` functions by hand.
  return jobValidity(await BACKGROUND_JOB_FAMILIES[delivery.jobKind].getJob(delivery.jobId));
}

/**
 * Whether a reminder delivery still owes a wake-up, and when. Read from the
 * job itself, never from the outbox row, so a republish follows the latest
 * edit and a job that has completed or been skipped gets no message at all.
 * The consumer still re-decides eligibility before anything is sent.
 */
async function reminderWakeupTarget(
  delivery: BackgroundJobDelivery,
  now: Date,
  reminderStore: Pick<ReminderStore, "getDeliveryJob">,
): Promise<{ validity: JobValidity | "busy"; deliverAt?: Date }> {
  const job = await reminderStore.getDeliveryJob(delivery.jobId);
  const deliverAt = reminderDeliveryWakeupTime(job, now);
  if (deliverAt) return { validity: "active", deliverAt };
  // A live claim is a dispatch in progress, which re-arms its own retry if it
  // needs one; it is neither finished nor owed a wake-up from this pass.
  return job?.status === "running" ? { validity: "busy" } : { validity: "obsolete" };
}

export async function recoverBackgroundJobDeliveries(input: {
  limit: number;
  /** Budget for re-arming reminder wake-ups the queue lost; zero skips the sweep. */
  lostReminderWakeupLimit?: number;
  now?: Date;
  store?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  inspectJob?: DeliveryJobInspector;
  reminderStore?: ReminderWakeupStore;
  logger?: BackgroundJobQueueLogger;
}): Promise<DeliveryRecoveryResult> {
  const now = input.now ?? new Date();
  const store = input.store ?? createDrizzleBackgroundJobDeliveryStore();
  const queue = input.queue ?? createVercelBackgroundJobQueueAdapter();
  const inspectJob = input.inspectJob ?? inspectDeliveryProcessorJob;
  let reminderStore = input.reminderStore;
  const getReminderStore = () => {
    reminderStore ??= createDrizzleReminderStore();
    return reminderStore;
  };
  const result: DeliveryRecoveryResult = {
    scanned: 0,
    republished: 0,
    failed: 0,
    abandoned: 0,
  };

  if (input.limit > 0) {
    await republishDueDeliveries({
      ...input,
      now,
      store,
      queue,
      inspectJob,
      getReminderStore,
      result,
    });
  }
  if ((input.lostReminderWakeupLimit ?? 0) > 0) {
    // A safety net must not take the rest of the pass down with it: a failure
    // here is logged and retried next pass while every later stage still runs.
    try {
      result.lostReminderWakeups = await recoverLostReminderWakeups({
        reminderStore: getReminderStore(),
        deliveryStore: store,
        queue,
        now,
        publishAhead: reminderDeliveryPublishesAhead(process.env),
        limit: input.lostReminderWakeupLimit ?? 0,
        logger: input.logger,
      });
    } catch (error) {
      input.logger?.error?.("reminder_delivery.lost_wakeup_sweep_failed", {
        errorCode: classifyBackgroundJobFailure(error),
      });
    }
  }

  return result;
}

async function republishDueDeliveries(input: {
  limit: number;
  now: Date;
  store: BackgroundJobDeliveryStore;
  queue: BackgroundJobQueueSendAdapter;
  inspectJob: DeliveryJobInspector;
  getReminderStore: () => Pick<ReminderStore, "getDeliveryJob">;
  logger?: BackgroundJobQueueLogger;
  result: DeliveryRecoveryResult;
}) {
  const { now, store, queue, result } = input;
  const dueDeliveries = await store.listDueBackgroundJobDeliveries({
    statuses: ["pending", "publish_failed"],
    now,
    limit: input.limit,
  });

  for (const delivery of dueDeliveries) {
    result.scanned += 1;
    const target =
      delivery.jobKind === "reminder_push"
        ? await reminderWakeupTarget(delivery, now, input.getReminderStore())
        : { validity: await input.inspectJob(delivery) };
    const jobValidity = target.validity;
    if (jobValidity === "busy") continue;

    if (jobValidity === "obsolete") {
      const abandoned = await store.updateBackgroundJobDelivery({
        ownerUserId: delivery.ownerUserId,
        deliveryId: delivery.id,
        status: "abandoned",
        lastError: "Processor job is terminal or no longer valid.",
        // Fenced to the revision inspected: a re-arm since then (a retry, an
        // edit) owns the row, and must not be abandoned on its behalf.
        revision: delivery.revision,
      });
      if (abandoned.status !== "abandoned") continue;
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
      // Fenced to the revision inspected above, so a concurrent edit's newer
      // revision is never sent with this pass's stale delivery time.
      ...(target.deliverAt ? { deliverAt: target.deliverAt, revision: delivery.revision } : {}),
      logger: input.logger,
    });

    if (publishResult.ok) {
      result.republished += 1;
    } else {
      result.failed += 1;
    }
  }
}

type ProcessorBackfillInput = {
  limit: number;
  now?: Date;
  /**
   * Epoch milliseconds after which no further job is claimed. A job already
   * claimed always finishes, so this bounds the pass rather than any one job.
   */
  claimUntil?: number;
  /** Reads the time `claimUntil` is compared to; tests drive it. */
  clock?: () => number;
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
    claimUntil: input.claimUntil,
    clock: input.clock,
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

function runOwnerDataExportBackfill(
  input: ProcessorBackfillInput & {
    jobs?: OwnerDataExportJobStore;
  },
): Promise<ProcessorBackfillResult> {
  if (input.limit <= 0) {
    return Promise.resolve({ scanned: 0, processed: 0, failed: 0 });
  }
  return runFamilyBackfill("owner_data_export", input).then(async (result) => {
    // Expiry is bounded by the same pass. Artifact bytes are operational
    // material, not a durable product record, so cleanup never waits for a
    // user request to discover an expired archive.
    await expireOwnerDataExportArtifacts({
      now: input.now,
      limit: input.limit,
      ...(input.jobs ? { jobs: input.jobs } : {}),
    });
    return result;
  });
}

/**
 * Finishes self-service deletions whose journal write or disposition failed at
 * request time, and flags any still incomplete after twenty-four hours (#616).
 * The production wiring is imported only when there is budget, so a pass given
 * none never reaches the auth server or the database.
 */
async function completePendingAccountDeletions(input: {
  limit: number;
  now?: Date;
  logger?: BackgroundJobQueueLogger;
}): Promise<AccountDeletionSweepResult> {
  if (input.limit <= 0) return { scanned: 0, completed: 0, failed: 0, stuck: 0 };
  const { accountDeletionDependencies } = await import("@/lib/auth/account-deletion");
  const { revokeUserSessions } = await import("@/lib/auth/server");
  return runAccountDeletionSweep({
    ...accountDeletionDependencies(revokeUserSessions),
    holdLiftedAt: await findLatestServiceWideHoldLift(),
    limit: input.limit,
    ...(input.now ? { now: input.now } : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

/**
 * Closes the household recovery window for the households whose thirty days are
 * up, disposing of the workspace's own records and leaving the minimized
 * non-content tombstone (#391). Each household's Deletion Record reaches the
 * Recovery Journal before its rows go (#618).
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
    journal: blobRecoveryJournal,
    ...(input.now ? { now: input.now } : {}),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

/**
 * Keeps the internal audit trail bounded on the same recovery pass.
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
  lostReminderWakeupLimit: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  actionExtractionBackfillLimit: number;
  contextFactExtractionBackfillLimit: number;
  ownerDataExportBackfillLimit: number;
  accountDeletionLimit: number;
  householdPurgeLimit: number;
  now: Date;
  backfillClaimUntil?: number;
  clock?: () => number;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries: typeof recoverBackgroundJobDeliveries;
  backfillExtraction: typeof runExtractionBackfill;
  backfillEmbedding: typeof runEmbeddingBackfill;
  backfillActionExtraction: typeof runActionExtractionBackfill;
  backfillContextFactExtraction: typeof runContextFactExtractionBackfill;
  backfillOwnerDataExport: typeof runOwnerDataExportBackfill;
  completeAccountDeletions: typeof completePendingAccountDeletions;
  purgeDissolvedHouseholds: typeof purgeDueDissolvedHouseholds;
}): Promise<Omit<BackgroundJobRecoveryRunResult, "auditRetention">> {
  // Each family gets its own attempt, in order: one that throws is logged and
  // the families after it still run, since the next pass is an hour away. The
  // first failure is still raised once every family has had its turn.
  const attempt = <T>(stage: string, run: () => Promise<T>) =>
    attemptRecoveryStage(stage, run, input.logger);
  const deliveries = await attempt("deliveries", () =>
    input.recoverDeliveries({
      limit: input.deliveryLimit,
      lostReminderWakeupLimit: input.lostReminderWakeupLimit,
      now: input.now,
      logger: input.logger,
    }),
  );
  const backfill = { now: input.now, claimUntil: input.backfillClaimUntil, clock: input.clock };
  const extraction = await attempt("extraction", () =>
    input.backfillExtraction({
      ...backfill,
      limit: input.extractionBackfillLimit,
      logger: input.logger,
    }),
  );
  const embedding = await attempt("embedding", () =>
    input.backfillEmbedding({
      ...backfill,
      limit: input.embeddingBackfillLimit,
      logger: input.logger,
    }),
  );
  const actionExtraction = await attempt("action_extraction", () =>
    input.backfillActionExtraction({
      ...backfill,
      limit: input.actionExtractionBackfillLimit,
      logger: input.logger,
    }),
  );
  const contextFactExtraction = await attempt("context_fact_extraction", () =>
    input.backfillContextFactExtraction({
      ...backfill,
      limit: input.contextFactExtractionBackfillLimit,
      logger: input.logger,
    }),
  );
  const ownerDataExport = await attempt("owner_data_export", () =>
    input.backfillOwnerDataExport({
      ...backfill,
      limit: input.ownerDataExportBackfillLimit,
      logger: input.logger,
    }),
  );
  const accountDeletion = await attempt("account_deletion", () =>
    input.completeAccountDeletions({
      limit: input.accountDeletionLimit,
      now: input.now,
      ...(input.logger ? { logger: input.logger } : {}),
    }),
  );
  const householdPurge = await attempt("household_purge", () =>
    input.purgeDissolvedHouseholds({
      limit: input.householdPurgeLimit,
      now: input.now,
      ...(input.logger ? { logger: input.logger } : {}),
    }),
  );

  // Read in stage order, so the first family that failed is the one raised.
  return {
    deliveries: settledValue(deliveries),
    extraction: settledValue(extraction),
    embedding: settledValue(embedding),
    actionExtraction: settledValue(actionExtraction),
    contextFactExtraction: settledValue(contextFactExtraction),
    ownerDataExport: settledValue(ownerDataExport),
    accountDeletion: settledValue(accountDeletion),
    householdPurge: settledValue(householdPurge),
  };
}

async function attemptRecoveryStage<T>(
  stage: string,
  run: () => Promise<T>,
  logger?: BackgroundJobQueueLogger,
): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await run() };
  } catch (reason) {
    try {
      // Only the class: a stage's message can carry database or provider detail.
      logger?.error?.("background_job_recovery.stage_failed", {
        stage,
        errorCode: classifyBackgroundJobFailure(reason),
      });
    } catch {
      // A diagnostic logger must never replace the failure being reported.
    }
    return { status: "rejected", reason };
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

type BackgroundJobRecoveryInput = {
  deliveryLimit: number;
  lostReminderWakeupLimit?: number;
  extractionBackfillLimit: number;
  embeddingBackfillLimit: number;
  actionExtractionBackfillLimit: number;
  contextFactExtractionBackfillLimit?: number;
  ownerDataExportBackfillLimit?: number;
  accountDeletionLimit?: number;
  householdPurgeLimit?: number;
  auditRetentionLimit?: number;
  /**
   * How long after the pass starts the processor backfills may keep claiming
   * jobs. Their per-family limits cover a full pass interval of deferred work,
   * so without a budget a large backlog could outrun the route's time limit and
   * cost the stages after it their pass.
   */
  backfillBudgetMs?: number;
  now?: Date;
  /** The wall clock the backfill budget is measured on; tests drive it. */
  clock?: () => number;
  logger?: BackgroundJobQueueLogger;
  recoverDeliveries?: typeof recoverBackgroundJobDeliveries;
  backfillExtraction?: typeof runExtractionBackfill;
  backfillEmbedding?: typeof runEmbeddingBackfill;
  backfillActionExtraction?: typeof runActionExtractionBackfill;
  backfillContextFactExtraction?: typeof runContextFactExtractionBackfill;
  backfillOwnerDataExport?: typeof runOwnerDataExportBackfill;
  completeAccountDeletions?: typeof completePendingAccountDeletions;
  purgeDissolvedHouseholds?: typeof purgeDueDissolvedHouseholds;
  retainAuditLog?: typeof retainExpiredAuditLogEntries;
};

type BackgroundJobRecoveryDependencies = {
  recoverDeliveries: typeof recoverBackgroundJobDeliveries;
  backfillExtraction: typeof runExtractionBackfill;
  backfillEmbedding: typeof runEmbeddingBackfill;
  backfillActionExtraction: typeof runActionExtractionBackfill;
  backfillContextFactExtraction: typeof runContextFactExtractionBackfill;
  backfillOwnerDataExport: typeof runOwnerDataExportBackfill;
  completeAccountDeletions: typeof completePendingAccountDeletions;
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
    backfillOwnerDataExport: input.backfillOwnerDataExport ?? runOwnerDataExportBackfill,
    completeAccountDeletions: input.completeAccountDeletions ?? completePendingAccountDeletions,
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
      lostReminderWakeupLimit: input.lostReminderWakeupLimit ?? 0,
      extractionBackfillLimit: input.extractionBackfillLimit,
      embeddingBackfillLimit: input.embeddingBackfillLimit,
      actionExtractionBackfillLimit: input.actionExtractionBackfillLimit,
      contextFactExtractionBackfillLimit: input.contextFactExtractionBackfillLimit ?? 0,
      ownerDataExportBackfillLimit: input.ownerDataExportBackfillLimit ?? 0,
      accountDeletionLimit: input.accountDeletionLimit ?? 0,
      householdPurgeLimit: input.householdPurgeLimit ?? 0,
      now,
      ...(input.backfillBudgetMs === undefined
        ? {}
        : { backfillClaimUntil: (input.clock ?? Date.now)() + input.backfillBudgetMs }),
      clock: input.clock,
      logger: input.logger,
      recoverDeliveries: dependencies.recoverDeliveries,
      backfillExtraction: dependencies.backfillExtraction,
      backfillEmbedding: dependencies.backfillEmbedding,
      backfillActionExtraction: dependencies.backfillActionExtraction,
      backfillContextFactExtraction: dependencies.backfillContextFactExtraction,
      backfillOwnerDataExport: dependencies.backfillOwnerDataExport,
      completeAccountDeletions: dependencies.completeAccountDeletions,
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
  jobKind: keyof typeof BACKGROUND_JOB_FAMILIES;
  limit: number;
  now?: Date;
  claimUntil?: number;
  clock?: () => number;
  claimNextJob: BackfillClaimNextJob;
  processJob: BackfillProcessJob;
  logger?: BackgroundJobQueueLogger;
  onProcessed?: (result: { affectedScopes?: AffectedScope[] }) => void | Promise<void>;
}): Promise<ProcessorBackfillResult> {
  const result: ProcessorBackfillResult = { scanned: 0, processed: 0, failed: 0 };
  const clock = input.clock ?? Date.now;

  for (let index = 0; index < input.limit; index += 1) {
    // Checked before each claim, never mid-job: what is left waits for the
    // next pass, exactly as a job past the per-family limit does.
    if (input.claimUntil !== undefined && clock() >= input.claimUntil) break;
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
