import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { runBackgroundJobRecovery } from "@/lib/background-jobs/recovery";

const DELIVERY_LIMIT = 25;
const EXTRACTION_BACKFILL_LIMIT = 5;
const EMBEDDING_BACKFILL_LIMIT = 5;
const ACTION_EXTRACTION_BACKFILL_LIMIT = 5;
const CONTEXT_FACT_EXTRACTION_BACKFILL_LIMIT = 5;
const OWNER_DATA_EXPORT_BACKFILL_LIMIT = 5;
/**
 * Households erased per pass. Small on purpose: each one is an irreversible
 * multi-table transaction, and a thirty-day deadline gives a backlog every ten
 * minutes to drain in rather than needing to clear in a single run.
 */
const HOUSEHOLD_PURGE_LIMIT = 3;
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
 * backfills, owner-export generation, household purges, audit-retention sweeps), so it
 * must never run unauthenticated.
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

  const result = await runBackgroundJobRecovery({
    deliveryLimit: DELIVERY_LIMIT,
    extractionBackfillLimit: EXTRACTION_BACKFILL_LIMIT,
    embeddingBackfillLimit: EMBEDDING_BACKFILL_LIMIT,
    actionExtractionBackfillLimit: ACTION_EXTRACTION_BACKFILL_LIMIT,
    contextFactExtractionBackfillLimit: CONTEXT_FACT_EXTRACTION_BACKFILL_LIMIT,
    ownerDataExportBackfillLimit: OWNER_DATA_EXPORT_BACKFILL_LIMIT,
    householdPurgeLimit: HOUSEHOLD_PURGE_LIMIT,
    auditRetentionLimit: AUDIT_RETENTION_LIMIT,
    logger: console,
  });

  return NextResponse.json(result);
}
