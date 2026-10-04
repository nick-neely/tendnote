import {
  type DeletionNoticeKind,
  type DeletionNoticeStage,
  dueDeletionNotice,
  HouseholdValidationError,
} from "@tendnote/domain";
import type { AccountDeletionLogger } from "../account-deletion/types";
import type { AccountRetentionStore, RetentionAccount } from "./types";

/**
 * The retention deadline carried out (#621): content-free deletion notices on
 * days 0, 60, and 83, then the purge through the account-deletion path, which
 * journals the Deletion Record before any row goes and confirms by email once
 * they have.
 */
export type AccountRetentionDependencies = {
  store: AccountRetentionStore;
  /** Sends one notice. Keyed so a repeat of the same notice collapses into one message. */
  sendNotice: (input: {
    to: string;
    userId: string;
    kind: DeletionNoticeKind;
    stage: DeletionNoticeStage;
    retentionDeadline: Date;
  }) => Promise<void>;
  /**
   * The household guard self-service deletion uses. It refuses, by throwing a
   * {@link HouseholdValidationError}, a deletion that would strand a household
   * without an Owner; the database would refuse that delete anyway, so the
   * purge never commits an intent it cannot finish.
   */
  assertDeletionAllowed: (input: { userId: string }) => Promise<void>;
  /**
   * Finishes a claimed purge: journal, delete, confirm. `pending` means the
   * intent committed, so the account is closed, but the rest is left to the
   * account-deletion recovery sweep.
   */
  purge: (input: { userId: string; now: Date }) => Promise<{ status: "deleted" | "pending" }>;
  logger?: AccountDeletionLogger;
};

export type AccountRetentionSweepResult = {
  scanned: number;
  notified: number;
  purged: number;
  /** Purges whose intent committed but whose deletion the recovery sweep will finish. */
  deferred: number;
  /** Purges the household guard refused, each alerted for the operator. */
  refused: number;
  failed: number;
};

async function purgeAccount(
  deps: AccountRetentionDependencies,
  account: RetentionAccount,
  now: Date,
  result: AccountRetentionSweepResult,
): Promise<void> {
  try {
    await deps.assertDeletionAllowed({ userId: account.userId });
  } catch (error) {
    if (!(error instanceof HouseholdValidationError)) throw error;
    result.refused += 1;
    deps.logger?.error?.("account_retention.purge_refused", { userId: account.userId });
    return;
  }
  const claimed = await deps.store.claimPurge({
    userId: account.userId,
    retentionDeadline: account.retentionDeadline,
    now,
  });
  if (!claimed) {
    // Expected when the account resubscribed since it was listed. A deadline
    // that never matches its own claim would be a bug, so it is visible.
    deps.logger?.info?.("account_retention.purge_not_claimed", { userId: account.userId });
    return;
  }
  const { status } = await deps.purge({ userId: account.userId, now });
  if (status === "deleted") {
    result.purged += 1;
    deps.logger?.info?.("account_retention.purged", { userId: account.userId });
  } else {
    result.deferred += 1;
  }
}

async function notifyAccount(
  deps: AccountRetentionDependencies,
  account: RetentionAccount,
  now: Date,
  result: AccountRetentionSweepResult,
): Promise<void> {
  const stage = dueDeletionNotice({
    sent: account.sentNotice,
    deadline: account.retentionDeadline,
    now,
  });
  if (!stage) return;
  // Sent before it is recorded: a failed record resends on the next pass, and
  // the send's key collapses that repeat into the message already delivered.
  await deps.sendNotice({
    to: account.email,
    userId: account.userId,
    kind: account.kind,
    stage,
    retentionDeadline: account.retentionDeadline,
  });
  await deps.store.recordNotice({
    userId: account.userId,
    retentionDeadline: account.retentionDeadline,
    stage,
    at: now,
  });
  result.notified += 1;
}

/**
 * One bounded pass over accounts with something due. Each account gets at most
 * one step: the notice it is owed, or, once its deadline has passed, the purge.
 * One account's failure is logged and leaves the rest of the pass to run.
 */
export async function runAccountRetentionSweep(
  input: AccountRetentionDependencies & { limit: number; now?: Date },
): Promise<AccountRetentionSweepResult> {
  const result: AccountRetentionSweepResult = {
    scanned: 0,
    notified: 0,
    purged: 0,
    deferred: 0,
    refused: 0,
    failed: 0,
  };
  if (input.limit <= 0) return result;

  const now = input.now ?? new Date();
  const accounts = await input.store.listDue({ now, limit: input.limit });

  for (const account of accounts) {
    result.scanned += 1;
    try {
      await input.store.markAttempted({
        userId: account.userId,
        retentionDeadline: account.retentionDeadline,
        at: now,
      });
      if (now.getTime() >= account.retentionDeadline.getTime()) {
        await purgeAccount(input, account, now, result);
      } else {
        await notifyAccount(input, account, now, result);
      }
    } catch (error) {
      result.failed += 1;
      input.logger?.error?.("account_retention.failed", {
        userId: account.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
