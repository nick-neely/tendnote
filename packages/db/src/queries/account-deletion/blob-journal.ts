import { type RecoveryJournal, recoveryJournalEntry } from "@tendnote/domain";
import { head, put } from "@vercel/blob";

/**
 * The Recovery Journal (ADR 0250) in the same private Blob store as uploaded
 * files, under its own `journal/` prefix: one immutable blob per record.
 *
 * Blob refuses to overwrite a pathname but reports the refusal as an
 * unspecific error, so a failed write is confirmed with `head`. If the blob is
 * there, an earlier attempt already wrote it and the record is durable.
 * Without Blob credentials every write fails, so deletions wait as intents
 * rather than deleting rows with no Deletion Record.
 */
export const blobRecoveryJournal: RecoveryJournal = {
  async write(record) {
    const entry = recoveryJournalEntry(record);
    try {
      await put(entry.pathname, entry.body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
      });
    } catch (error) {
      const exists = await head(entry.pathname).then(
        () => true,
        () => false,
      );
      if (!exists) throw error;
    }
  },
};
