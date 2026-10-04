import type { RestoredFence } from "@tendnote/domain";
import { RETENTION } from "@tendnote/domain/retention";
import { eq, inArray, lte } from "drizzle-orm";
import { getDb } from "../client";
import { restoredEmailFences } from "../schema";

/** Whether a restore recorded that the email under this key digest already left. */
export async function isRestoredEmailFenced(input: { digest: string }): Promise<boolean> {
  const [row] = await getDb()
    .select({ digest: restoredEmailFences.digest })
    .from(restoredEmailFences)
    .where(eq(restoredEmailFences.digest, input.digest))
    .limit(1);
  return Boolean(row);
}

/** Copies email fences into the restored database. Safe to repeat. */
export async function recordRestoredEmailFences(fences: RestoredFence[]): Promise<void> {
  for (let start = 0; start < fences.length; start += 500) {
    await getDb()
      .insert(restoredEmailFences)
      .values(fences.slice(start, start + 500))
      .onConflictDoNothing();
  }
}

/** How many of these distinct digests the restored database holds, for verification. */
export async function countRestoredEmailFences(digests: string[]): Promise<number> {
  let found = 0;
  for (let start = 0; start < digests.length; start += 500) {
    const rows = await getDb()
      .select({ digest: restoredEmailFences.digest })
      .from(restoredEmailFences)
      .where(inArray(restoredEmailFences.digest, digests.slice(start, start + 500)));
    found += rows.length;
  }
  return found;
}

/**
 * Deletes copied fences past the fence retention constant, as the Blob sweep
 * deletes the fences they copy: by then no restore could need them.
 */
export async function sweepRestoredEmailFences(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION.effectFence.days * 24 * 60 * 60 * 1000);
  const deleted = await getDb()
    .delete(restoredEmailFences)
    .where(lte(restoredEmailFences.fencedAt, cutoff))
    .returning({ digest: restoredEmailFences.digest });
  return { deleted: deleted.length };
}
