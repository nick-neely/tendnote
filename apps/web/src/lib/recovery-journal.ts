import {
  type AdmissionEnvironment,
  parseAdmissionPolicy,
  type RecoveryJournal,
  recoveryJournalEntry,
} from "@tendnote/domain";
import { head, put } from "@vercel/blob";

type BlobClient = {
  put: (
    pathname: string,
    body: string,
    options: {
      access: "private";
      addRandomSuffix: false;
      allowOverwrite: false;
      contentType: string;
      token: string;
    },
  ) => Promise<unknown>;
  head: (pathname: string, options: { token: string }) => Promise<unknown>;
};

/**
 * The Recovery Journal on a private Vercel Blob store (ADR 0250): one
 * immutable blob per record.
 *
 * Blob refuses to overwrite a pathname, but reports that refusal as an
 * unspecific error. A failed write is therefore confirmed with `head`: if the
 * blob is there, an earlier attempt already wrote it, and the record is durable.
 */
export function createBlobRecoveryJournal(input: {
  token: string;
  client?: BlobClient;
}): RecoveryJournal {
  const client = input.client ?? { put, head };
  return {
    async write(record) {
      const entry = recoveryJournalEntry(record);
      try {
        await client.put(entry.pathname, entry.body, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/json",
          token: input.token,
        });
      } catch (error) {
        const exists = await client.head(entry.pathname, { token: input.token }).then(
          () => true,
          () => false,
        );
        if (!exists) throw error;
      }
    },
  };
}

type RecoveryJournalEnvironment = AdmissionEnvironment & {
  NODE_ENV?: string;
  RECOVERY_JOURNAL_READ_WRITE_TOKEN?: string;
};

/**
 * The journal this deployment writes to. The Backup Window promise belongs to
 * hosted production, so there a missing store refuses every write: deletions
 * then wait as intents and the stuck-intent alert fires, rather than rows being
 * deleted with no Deletion Record. A self-hosted or development deployment
 * without a store makes no such promise and skips the journal.
 */
export function resolveRecoveryJournal(
  env: RecoveryJournalEnvironment = process.env,
): RecoveryJournal {
  const token = env.RECOVERY_JOURNAL_READ_WRITE_TOKEN?.trim();
  if (token) return createBlobRecoveryJournal({ token });

  if (env.NODE_ENV === "production" && parseAdmissionPolicy(env).mode === "hosted") {
    return {
      async write() {
        throw new Error(
          "The Recovery Journal is not configured (RECOVERY_JOURNAL_READ_WRITE_TOKEN).",
        );
      },
    };
  }

  return {
    async write() {
      console.warn("[tendnote] Recovery Journal not configured; Deletion Record skipped");
    },
  };
}
