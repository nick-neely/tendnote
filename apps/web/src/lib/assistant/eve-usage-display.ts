import { readEveUsageNotice } from "@tendnote/db/queries/usage-bounds";
import type { UsageNotice } from "@tendnote/domain/usage-bounds";

/**
 * Interactive Eve's usage notice for a page to show, or `undefined` when it
 * cannot be read. The notice is advisory here: Eve's door makes the real
 * decision and fails closed on its own read, so a failed read must not take
 * down a page whose records, reminders, and conversations still work.
 */
export async function readEveUsageForDisplay(
  userId: string,
  read: typeof readEveUsageNotice = readEveUsageNotice,
): Promise<UsageNotice | undefined> {
  try {
    return await read({ userId });
  } catch (error) {
    console.warn("usage: could not read Eve's usage notice for display", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
}
