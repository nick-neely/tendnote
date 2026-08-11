import { type NextRequest, NextResponse } from "next/server";
import { runBackgroundJobRecovery } from "@/lib/background-jobs/recovery";

const DELIVERY_LIMIT = 25;
const EXTRACTION_BACKFILL_LIMIT = 5;
const EMBEDDING_BACKFILL_LIMIT = 5;
const ACTION_EXTRACTION_BACKFILL_LIMIT = 5;
const CONTEXT_FACT_EXTRACTION_BACKFILL_LIMIT = 5;
/**
 * Households erased per pass. Small on purpose: each one is an irreversible
 * multi-table transaction, and a thirty-day deadline gives a backlog every ten
 * minutes to drain in rather than needing to clear in a single run.
 */
const HOUSEHOLD_PURGE_LIMIT = 3;

// Route segment config must remain a statically analyzable literal for Next.js.
export const maxDuration = 300;

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
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
    householdPurgeLimit: HOUSEHOLD_PURGE_LIMIT,
    logger: console,
  });

  return NextResponse.json(result);
}
