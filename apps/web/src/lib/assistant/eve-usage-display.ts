import { readEveUsageNotice, readUsageNotices } from "@tendnote/db/queries/usage-bounds";
import type { UsageNotice, UsageNotices } from "@tendnote/domain/usage-bounds";
import type { BackgroundUsage } from "./usage-notice";

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

/**
 * Background work's and scheduled workflows' usage notices for Home to show,
 * or `undefined` when they cannot be read. Advisory like Eve's: the model-call
 * entry point refuses background calls while paused on its own read.
 */
export async function readBackgroundUsageForDisplay(
  userId: string,
  read: (input: { userId: string }) => Promise<UsageNotices> = readUsageNotices,
): Promise<BackgroundUsage | undefined> {
  try {
    const { background, scheduled } = await read({ userId });
    return { background, scheduled };
  } catch (error) {
    console.warn("usage: could not read background usage for display", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
}
