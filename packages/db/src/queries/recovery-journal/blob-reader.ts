import {
  isDeletionRecordExpired,
  type RecoveryJournalEntry,
  recoveryJournalPrefix,
} from "@tendnote/domain";
import { del, get, list } from "@vercel/blob";
import { writeImmutableBlob } from "../account-deletion/blob-journal";

/**
 * The read side of the Recovery Journal's Blob store, which only a restore and
 * the retention sweeps use (ADR 0250). Product code never reads the journal.
 */
export type RecoveryJournalStore = {
  /** Every pathname under a prefix, in pathname (time) order, paged to the end. */
  list: (prefix: string) => Promise<string[]>;
  /** One entry's body read from origin, so a cached copy can never stand in. */
  read: (pathname: string) => Promise<RecoveryJournalEntry | null>;
  /** Writes an entry once; writing it again is a no-op. */
  write: (entry: RecoveryJournalEntry) => Promise<void>;
};

export const blobRecoveryJournalStore: RecoveryJournalStore = {
  async list(prefix) {
    const pathnames: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      pathnames.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return pathnames;
  },
  async read(pathname) {
    const result = await get(pathname, { access: "private", useCache: false });
    if (result?.statusCode !== 200) return null;
    return { pathname, body: await new Response(result.stream).text() };
  },
  write: writeImmutableBlob,
};

/**
 * Deletes Deletion Records older than Deletion Record Retention, at most
 * `limit` a pass. The prefix lists in time order, so listing stops at the
 * first record still kept. A failure is logged and left for the next pass,
 * like the fence sweep beside it.
 */
export async function sweepDeletionRecords(input: { now?: Date; limit?: number } = {}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 100;
  try {
    const { blobs } = await list({ prefix: recoveryJournalPrefix("deletion"), limit });
    const expired: string[] = [];
    for (const blob of blobs) {
      if (!isDeletionRecordExpired({ pathname: blob.pathname, now })) break;
      expired.push(blob.pathname);
    }
    if (expired.length > 0) await del(expired);
    return { deleted: expired.length, failed: false };
  } catch {
    console.warn("recovery-journal: Deletion Record retention sweep failed; the next pass retries");
    return { deleted: 0, failed: true };
  }
}
