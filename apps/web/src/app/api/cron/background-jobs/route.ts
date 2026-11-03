import { timingSafeEqual } from "node:crypto";
import { sweepAccountFunnelEvents } from "@tendnote/db/queries/account-telemetry";
import { sweepEffectFences } from "@tendnote/db/queries/effect-fences";
import { sweepFileStorage } from "@tendnote/db/queries/file-uploads";
import { isOutboundPaused } from "@tendnote/db/queries/outbound-pause";
import { sweepPublicActivityCounts } from "@tendnote/db/queries/public-activity";
import { sweepDeletionRecords } from "@tendnote/db/queries/recovery-journal";
import { sweepRestoredEmailFences } from "@tendnote/db/queries/restored-email-fences";
import { isServiceWideHoldActive } from "@tendnote/db/queries/service-wide-hold";
import { sweepUsageLedger } from "@tendnote/db/queries/usage-ledger";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { carryOutRetentionDeadlines } from "@/lib/access/account-retention";
import { classifyBackgroundJobFailure } from "@/lib/background-jobs/failure-observability";
import { runBackgroundJobRecovery } from "@/lib/background-jobs/recovery";
import { paidAccessProjection } from "@/lib/billing/paid-access-projection";
import { createStripeReconciliation } from "@/lib/billing/stripe-reconciliation";
import { runOperatorAlerts } from "@/lib/operator-alerts/pass";

const DELIVERY_LIMIT = 25;
/**
 * Reminder jobs re-armed per pass because their queue wake-up was lost or
 * expired. Normally zero: delayed messages wake reminders on time (ADR 0267).
 */
const LOST_REMINDER_WAKEUP_LIMIT = 25;
/**
 * Jobs per family the backfill claims in one pass. Normally none are waiting:
 * a job publishes to the queue when it is enqueued. What lands here is a
 * failure retry or work an Account Ceiling or the Spend Breaker deferred, which
 * all comes due at once when the breaker closes at midnight. Thirty an hour is
 * the five every ten minutes the backfill drained before passes became hourly
 * (ADR 0269); `BACKFILL_BUDGET_MS` keeps the larger batch inside the pass.
 */
const PROCESSOR_BACKFILL_LIMIT = 30;
/** Export generation is rarely deferred and much heavier, so it stays small. */
const OWNER_DATA_EXPORT_BACKFILL_LIMIT = 5;
/**
 * How long the processor backfills may keep claiming jobs, measured from the
 * start of recovery. Well inside `maxDuration` so a job claimed at the limit
 * can finish and the sweeps, alerts, and retention after it still run.
 */
const BACKFILL_BUDGET_MS = 120_000;
/**
 * Account deletions resumed per pass. Normally zero are waiting: a deletion
 * only lands here when its journal write or disposition failed at request time.
 */
const ACCOUNT_DELETION_LIMIT = 10;
/**
 * Households erased per pass. Small on purpose: each one is an irreversible
 * multi-table transaction, and a thirty-day deadline gives a backlog every
 * pass to drain in rather than needing to clear in a single run.
 */
const HOUSEHOLD_PURGE_LIMIT = 3;
/**
 * Accounts given a deletion notice or purged per pass. A purge is one account
 * deletion; an hourly pass against deadlines measured in days drains any
 * backlog long before a notice is late by more than a pass.
 */
const ACCOUNT_RETENTION_LIMIT = 25;
/** Audit evidence is cheaper than a household purge, but stays bounded per pass. */
const AUDIT_RETENTION_LIMIT = 100;

// Route segment config must remain a statically analyzable literal for Next.js.
export const maxDuration = 300;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  // Length is compared first (and short-circuits) because timingSafeEqual throws on a
  // length mismatch; the length of a fixed-format Bearer header is not itself a secret.
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}

/**
 * This route triggers expensive and irreversible recovery work (extraction/embedding
 * backfills, owner-export generation, household purges, retention-deadline notices and
 * purges, audit, Usage Ledger, account funnel, public activity, effect fence, and Deletion
 * Record retention sweeps, and operator alerts), so it must never run unauthenticated.
 *
 * Vercel Cron invokes it with `Authorization: Bearer $CRON_SECRET`, so a configured
 * secret is compared against that header in constant time.
 *
 * Fail-closed: with no `CRON_SECRET` configured the route is rejected. The only escape
 * is a deliberate, development-only opt-in (`ALLOW_UNAUTHENTICATED_CRON=true`), which is
 * ignored in production and preview (`NODE_ENV === "production"` covers both) so it can
 * never expose the route on a real deployment.
 */
function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    return timingSafeEqualStrings(
      request.headers.get("authorization") ?? "",
      `Bearer ${cronSecret}`,
    );
  }

  return process.env.NODE_ENV !== "production" && process.env.ALLOW_UNAUTHENTICATED_CRON === "true";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A restore holds every pass until the operator resumes outbound (#623). A
  // missed pass is ordinary for a cron, so nothing here needs to catch up.
  if (await isOutboundPaused()) {
    return NextResponse.json({ status: "paused" });
  }
  // A Service-Wide Hold (#634) holds every pass too, so export, deletion, and
  // their alerts wait for the lift. The proxy already refuses this route on a
  // hosted deployment; this keeps the rule wherever the route is reached.
  if (await isServiceWideHoldActive()) {
    return NextResponse.json({ status: "held" });
  }

  // First, because it never throws: a failing recovery stage below must not
  // stop a paying customer whose webhook was dropped from being admitted.
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const reconcileStripe = createStripeReconciliation({
    ...paidAccessProjection,
    policy: parseAdmissionPolicy(),
    stripe: secretKey ? new Stripe(secretKey) : null,
    logger: console,
  });
  const stripeReconciliation = await reconcileStripe();

  // Every later stage gets its own attempt: one that throws is logged and
  // reported, and the stages after it still run. A pass is an hour apart, so a
  // stage skipped here would otherwise wait that long for its next chance.
  const failedStages: string[] = [];
  const stage = <T>(name: string, run: () => Promise<T>) => runStage(name, run, failedStages);

  const result = await stage("recovery", () =>
    runBackgroundJobRecovery({
      deliveryLimit: DELIVERY_LIMIT,
      lostReminderWakeupLimit: LOST_REMINDER_WAKEUP_LIMIT,
      extractionBackfillLimit: PROCESSOR_BACKFILL_LIMIT,
      embeddingBackfillLimit: PROCESSOR_BACKFILL_LIMIT,
      actionExtractionBackfillLimit: PROCESSOR_BACKFILL_LIMIT,
      contextFactExtractionBackfillLimit: PROCESSOR_BACKFILL_LIMIT,
      ownerDataExportBackfillLimit: OWNER_DATA_EXPORT_BACKFILL_LIMIT,
      backfillBudgetMs: BACKFILL_BUDGET_MS,
      accountDeletionLimit: ACCOUNT_DELETION_LIMIT,
      householdPurgeLimit: HOUSEHOLD_PURGE_LIMIT,
      auditRetentionLimit: AUDIT_RETENTION_LIMIT,
      logger: console,
    }),
  );

  const files = await stage("files", sweepFileStorage);
  const usageLedger = await stage("usage_ledger", sweepUsageLedger);
  const accountFunnel = await stage("account_funnel", sweepAccountFunnelEvents);
  const publicActivity = await stage("public_activity", sweepPublicActivityCounts);
  const effectFences = await stage("effect_fences", sweepEffectFences);
  const restoredEmailFences = await stage("restored_email_fences", sweepRestoredEmailFences);
  const deletionRecords = await stage("deletion_records", sweepDeletionRecords);
  // It never throws, so it runs before the retention step, which is last on purpose.
  const operatorAlerts = await runOperatorAlerts({ stripeReconciliation });
  // Last, so a failure here never costs the housekeeping sweeps above their pass.
  const accountRetention = await stage("account_retention", () =>
    carryOutRetentionDeadlines({ limit: ACCOUNT_RETENTION_LIMIT }),
  );
  return NextResponse.json(
    {
      ...(isFailedStage(result) ? {} : result),
      ...(failedStages.length > 0 ? { failedStages } : {}),
      accountRetention,
      files,
      usageLedger,
      accountFunnel,
      publicActivity,
      effectFences,
      restoredEmailFences,
      deletionRecords,
      stripeReconciliation,
      operatorAlerts,
    },
    // A failed stage still fails the invocation, so the cron's own failure
    // reporting sees it; only the stages after it are no longer lost.
    { status: failedStages.length > 0 ? 500 : 200 },
  );
}

type FailedStage = { status: "failed" };

function isFailedStage(value: object): value is FailedStage {
  return "status" in value && value.status === "failed";
}

/**
 * Runs one pass stage, turning a throw into a logged, content-free failure so
 * the stages after it still run. Only the error's class is logged: a stage's
 * message can carry database or provider detail.
 */
async function runStage<T>(
  name: string,
  run: () => Promise<T>,
  failedStages: string[],
): Promise<T | FailedStage> {
  try {
    return await run();
  } catch (error) {
    failedStages.push(name);
    console.error("background_jobs.stage_failed", {
      stage: name,
      errorCode: classifyBackgroundJobFailure(error),
    });
    return { status: "failed" };
  }
}
