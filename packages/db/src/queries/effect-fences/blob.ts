import {
  type EffectFences,
  effectFenceEntry,
  effectFencePrefix,
  FENCED_EFFECTS,
  isEffectFenceExpired,
} from "@tendnote/domain";
import { del, list } from "@vercel/blob";
import { writeImmutableBlob } from "../account-deletion/blob-journal";

/**
 * Effect Fences (ADR 0250) in the Recovery Journal's private Blob store, under
 * `fence/`: one immutable blob per completed email send or export delivery.
 */
export const blobEffectFences: EffectFences = {
  async write(fence) {
    await writeImmutableBlob(effectFenceEntry(fence));
  },
};

/**
 * Deletes fences older than their retention constant, at most `limit` a pass.
 * Each effect's prefix lists in time order, so listing stops at the first
 * fence still kept; a backlog drains over later passes rather than in one. A
 * failure is logged and left for the next pass, so the store being unreachable
 * never stops the rest of the recovery cron.
 */
export async function sweepEffectFences(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  let budget = input.limit ?? 100;
  let deleted = 0;
  try {
    for (const effect of FENCED_EFFECTS) {
      if (budget <= 0) break;
      const { blobs } = await list({ prefix: effectFencePrefix(effect), limit: budget });
      const expired: string[] = [];
      for (const blob of blobs) {
        if (!isEffectFenceExpired({ pathname: blob.pathname, now })) break;
        expired.push(blob.pathname);
      }
      if (expired.length > 0) await del(expired);
      deleted += expired.length;
      budget -= expired.length;
    }
  } catch {
    console.warn("effect-fences: retention sweep failed; the next pass retries");
    return { deleted, failed: true };
  }
  return { deleted, failed: false };
}
