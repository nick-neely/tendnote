import { timingSafeEqual } from "node:crypto";
import { sweepAccountFunnelEvents } from "@tendnote/db/queries/account-telemetry";
import { sweepEffectFences } from "@tendnote/db/queries/effect-fences";
import { sweepFileStorage } from "@tendnote/db/queries/file-uploads";
import { sweepPublicActivityCounts } from "@tendnote/db/queries/public-activity";
import { sweepUsageLedger } from "@tendnote/db/queries/usage-ledger";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { carryOutRetentionDeadlines } from "@/lib/access/account-retention";
import { runBackgroundJobRecovery } from "@/lib/background-jobs/recovery";
import { paidAccessProjection } from "@/lib/billing/paid-access-projection";
import { createStripeReconciliation } from "@/lib/billing/stripe-reconciliation";

const DELIVERY_LIMIT = 25;
const EXTRACTION_BACKFILL_LIMIT = 5;
const EMBEDDING_BACKFILL_LIMIT = 5;
const ACTION_EXTRACTION_BACKFILL_LIMIT = 5;
const CONTEXT_FACT_EXTRACTION_BACKFILL_LIMIT = 5;
const OWNER_DATA_EXPORT_BACKFILL_LIMIT = 5;
/**
 * Account deletions resumed per pass. Normally zero are waiting: a deletion
 * only lands here when its journal write or disposition failed at request time.
 */
const ACCOUNT_DELETION_LIMIT = 10;
/**
 * Households erased per pass. Small on purpose: each one is an irreversible
 * multi-table transaction, and a thirty-day deadline gives a backlog every ten
 * minutes to drain in rather than needing to clear in a single run.
 */
const HOUSEHOLD_PURGE_LIMIT = 3;
/**
 * Accounts given a deletion notice or purged per pass. A purge is one account
 * deletion; a ten-minute pass against deadlines measured in days drains any
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
 * purges, audit, Usage Ledger, account funnel, public activity, and effect fence retention
 * sweeps), so it must never run unauthenticated.
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

  const result = await runBackgroundJobRecovery({
    deliveryLimit: DELIVERY_LIMIT,
    extractionBackfillLimit: EXTRACTION_BACKFILL_LIMIT,
    embeddingBackfillLimit: EMBEDDING_BACKFILL_LIMIT,
    actionExtractionBackfillLimit: ACTION_EXTRACTION_BACKFILL_LIMIT,
    contextFactExtractionBackfillLimit: CONTEXT_FACT_EXTRACTION_BACKFILL_LIMIT,
    ownerDataExportBackfillLimit: OWNER_DATA_EXPORT_BACKFILL_LIMIT,
    accountDeletionLimit: ACCOUNT_DELETION_LIMIT,
    householdPurgeLimit: HOUSEHOLD_PURGE_LIMIT,
    auditRetentionLimit: AUDIT_RETENTION_LIMIT,
    logger: console,
  });

  const files = await sweepFileStorage();
  const usageLedger = await sweepUsageLedger();
  const accountFunnel = await sweepAccountFunnelEvents();
  const publicActivity = await sweepPublicActivityCounts();
  const effectFences = await sweepEffectFences();
  // Last, so a failure here never costs the housekeeping sweeps above their pass.
  const accountRetention = await carryOutRetentionDeadlines({ limit: ACCOUNT_RETENTION_LIMIT });
  return NextResponse.json({
    ...result,
    accountRetention,
    files,
    usageLedger,
    accountFunnel,
    publicActivity,
    effectFences,
    stripeReconciliation,
  });
}
