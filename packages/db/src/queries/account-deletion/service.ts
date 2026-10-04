import {
  type AdmissionBlock,
  type DeletionRecord,
  isDeletionIntentStuck,
  type RecoveryJournal,
} from "@tendnote/domain";
import type { AccountDeletionIntent, AccountDeletionLogger, AccountDeletionStore } from "./types";

/**
 * Self-service account deletion in the Recovery Journal's write-before-delete
 * order (ADR 0250): commit an intent, write the Deletion Record, then delete.
 *
 * The intent is the durable fact of the request and lives in the same database
 * as the rows it will delete, so a restore that rolls it back rolls the
 * deletion back with it. Rows are deleted only after the journal confirms, so
 * there is no reachable state in which an account is gone without a Deletion
 * Record for the restore to re-apply.
 */
export type AccountDeletionDependencies = {
  store: AccountDeletionStore;
  journal: RecoveryJournal;
  /** Ends every session the account holds. Safe to repeat. */
  revokeSessions: (input: { userId: string }) => Promise<void>;
  /**
   * Cancels the account's live subscriptions at once, with no refund of the
   * remainder. Safe to repeat, and a no-op for an account that never billed.
   */
  cancelSubscriptions: (input: { userId: string }) => Promise<void>;
  /**
   * Confirms by email that a retention-deadline purge happened (#621). Called
   * once the rows are gone, with the address read before they went; the owner's
   * own deletion is not confirmed.
   */
  confirmPurge: (input: { to: string; userId: string; requestedAt: Date }) => Promise<void>;
  logger?: AccountDeletionLogger;
};

/**
 * The record for an intent. Its time is the request's, not the attempt's, so
 * every retry writes the same pathname and the journal's write-once rule makes
 * the retry a no-op.
 */
function deletionRecord(intent: AccountDeletionIntent): DeletionRecord {
  return {
    kind: "deletion",
    subjectKind: "account",
    subjectId: intent.userId,
    at: intent.requestedAt,
  };
}

/**
 * Finishes an intent, or stops short of the purge while a Legal Hold covers
 * the account (#632). A held intent stays committed, so the account stays
 * closed, and the sweep finishes it once the hold ends.
 */
async function completeIntent(
  deps: AccountDeletionDependencies,
  intent: AccountDeletionIntent,
  now: Date,
): Promise<"deleted" | "held"> {
  // Billing stops before anything is journaled or deleted: the account closed
  // at commit, and the Stripe customer the cancellation needs is deleted with
  // the account. It runs on every attempt, journaled or not, so an intent
  // journaled before this step existed is never deleted while still billing.
  // A failure leaves the intent for the sweep. A hold blocks only the purge,
  // so billing stops even for a held account.
  await deps.cancelSubscriptions({ userId: intent.userId });
  // Checked at the last safe point, before the Deletion Record: a record a
  // restore could re-apply must never exist for held data.
  if (await deps.store.isHeld({ userId: intent.userId, now })) return "held";
  if (!intent.journaledAt) {
    await deps.journal.write(deletionRecord(intent));
    await deps.store.markJournaled({ userId: intent.userId, at: now });
  }
  const confirmTo =
    intent.reason === "retention_deadline"
      ? await deps.store.findAccountEmail({ userId: intent.userId })
      : null;
  await deps.store.deleteAccount({ userId: intent.userId });
  if (confirmTo) await confirmCompletedPurge(deps, intent, confirmTo);
  return "deleted";
}

/**
 * A failed send never undoes or delays the purge it reports. The address left
 * with the account, so the failure is logged for the operator rather than
 * retried. Reading the address is different: it reads the row the delete is
 * about to remove, so a failure there retries with the delete instead of
 * deleting without the address and losing the confirmation.
 */
async function confirmCompletedPurge(
  deps: AccountDeletionDependencies,
  intent: AccountDeletionIntent,
  to: string,
): Promise<void> {
  try {
    await deps.confirmPurge({ to, userId: intent.userId, requestedAt: intent.requestedAt });
  } catch (error) {
    deps.logger?.error?.("account_deletion.purge_confirmation_failed", {
      userId: intent.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Accept a customer's deletion. The account is closed once the intent commits,
 * whatever happens after: a failed journal write or disposition leaves the
 * intent for {@link runAccountDeletionSweep} and still answers `pending`
 * rather than an error, because the request itself has succeeded. So does a
 * Legal Hold, which blocks the purge and nothing else about the exit.
 */
export async function requestAccountDeletion(
  deps: AccountDeletionDependencies,
  input: { userId: string; now?: Date },
): Promise<{ status: "deleted" | "pending" }> {
  const now = input.now ?? new Date();
  const intent = await deps.store.commitIntent({ userId: input.userId, at: now });

  // Revoked at commit, but a failure here must not undo the accepted request:
  // admission already refuses the account, and the sweep revokes again before
  // finishing any deletion it resumes.
  try {
    await deps.revokeSessions({ userId: input.userId });
  } catch (error) {
    deps.logger?.error?.("account_deletion.session_revocation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if ((await completeIntent(deps, intent, now)) === "held") {
      deps.logger?.info?.("account_deletion.held", { userId: input.userId });
      return { status: "pending" };
    }
    return { status: "deleted" };
  } catch (error) {
    deps.logger?.error?.("account_deletion.deferred", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "pending" };
  }
}

export type AccountDeletionSweepResult = {
  scanned: number;
  completed: number;
  failed: number;
  /** Intents still incomplete after twenty-four hours, each alerted. */
  stuck: number;
};

/**
 * One bounded recovery pass over incomplete intents, oldest first. Each intent
 * resumes at the step it stopped at, and one that is still incomplete after
 * twenty-four hours is logged as `account_deletion.intent_stuck` for the
 * operator alert channel. An intent under a Legal Hold is left until the hold
 * ends.
 */
export async function runAccountDeletionSweep(
  input: AccountDeletionDependencies & { limit: number; now?: Date },
): Promise<AccountDeletionSweepResult> {
  const result: AccountDeletionSweepResult = { scanned: 0, completed: 0, failed: 0, stuck: 0 };
  if (input.limit <= 0) return result;

  const now = input.now ?? new Date();
  const intents = await input.store.listIntents({ limit: input.limit, now });

  for (const intent of intents) {
    result.scanned += 1;
    try {
      await input.store.markAttempted({ userId: intent.userId, at: now });
      await input.revokeSessions({ userId: intent.userId });
      // Held only if the hold was placed after the list was read.
      if ((await completeIntent(input, intent, now)) === "held") {
        input.logger?.info?.("account_deletion.held", { userId: intent.userId });
        continue;
      }
      result.completed += 1;
      input.logger?.info?.("account_deletion.completed", { userId: intent.userId });
    } catch (error) {
      result.failed += 1;
      input.logger?.error?.("account_deletion.failed", {
        userId: intent.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (isDeletionIntentStuck({ requestedAt: intent.requestedAt, now })) {
        result.stuck += 1;
        input.logger?.error?.("account_deletion.intent_stuck", {
          userId: intent.userId,
          requestedAt: intent.requestedAt.toISOString(),
        });
      }
    }
  }

  return result;
}

/**
 * The admission block a committed intent raises. It admits no exception: an
 * account being deleted is closed.
 */
export function accountDeletionAdmissionBlocks(
  intent: AccountDeletionIntent | null,
): AdmissionBlock[] {
  if (!intent) return [];
  return [
    {
      kind: "account_deletion",
      event: `account_deletion:${intent.requestedAt.toISOString()}`,
      exceptions: [],
    },
  ];
}
