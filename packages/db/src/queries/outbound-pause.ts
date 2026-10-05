import { getDb } from "../client";
import { outboundPause } from "../schema";

/**
 * Whether a restore is holding outbound work (#623): the recovery cron, every
 * queue consumer, and every email send ask before they act.
 */
export async function isOutboundPaused(): Promise<boolean> {
  const [row] = await getDb()
    .select({ pausedAt: outboundPause.pausedAt })
    .from(outboundPause)
    .limit(1);
  return Boolean(row);
}

/** Holds outbound work. Safe to repeat: an existing pause keeps its time. */
export async function pauseOutbound(input: { at: Date }): Promise<void> {
  await getDb().insert(outboundPause).values({ pausedAt: input.at }).onConflictDoNothing();
}

/** Releases outbound work. Safe to repeat. */
export async function resumeOutbound(): Promise<void> {
  await getDb().delete(outboundPause);
}
