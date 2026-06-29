import { type NextRequest, NextResponse } from "next/server";
import { runBackgroundJobRecovery } from "@/lib/background-jobs/recovery";

const DELIVERY_LIMIT = 25;
const EXTRACTION_BACKFILL_LIMIT = 5;
const EMBEDDING_BACKFILL_LIMIT = 5;

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
    logger: console,
  });

  return NextResponse.json(result);
}
