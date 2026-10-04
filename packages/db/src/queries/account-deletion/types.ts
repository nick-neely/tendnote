import type { accountDeletionReason } from "../../schema";

/**
 * Why a deletion was committed: the owner asked (#616), or the account's
 * retention deadline passed (#621). Only the second is confirmed by email.
 */
export type AccountDeletionReason = (typeof accountDeletionReason.enumValues)[number];

/** A committed deletion not yet finished. Ids and moments; no content. */
export type AccountDeletionIntent = {
  userId: string;
  requestedAt: Date;
  reason: AccountDeletionReason;
  /** When the Deletion Record was confirmed in the Recovery Journal. */
  journaledAt: Date | null;
};

export type AccountDeletionStore = {
  /** Commits the intent, or returns the one already committed for the account. */
  commitIntent: (input: { userId: string; at: Date }) => Promise<AccountDeletionIntent>;
  findIntent: (input: { userId: string }) => Promise<AccountDeletionIntent | null>;
  /**
   * Incomplete intents, never-retried first and then least recently retried,
   * oldest request breaking ties. An intent that keeps failing therefore moves
   * behind the others instead of holding the sweep's budget every pass.
   */
  listIntents: (input: { limit: number }) => Promise<AccountDeletionIntent[]>;
  /** Records a recovery attempt, for the order above. */
  markAttempted: (input: { userId: string; at: Date }) => Promise<void>;
  markJournaled: (input: { userId: string; at: Date }) => Promise<void>;
  /** The account's address, read before its rows go so a purge can be confirmed after. */
  findAccountEmail: (input: { userId: string }) => Promise<string | null>;
  /**
   * The existing household-aware disposition: deleting the account row, whose
   * database trigger and foreign keys decide what goes and what stays with a
   * Household. The intent goes with it, which is what completes it.
   */
  deleteAccount: (input: { userId: string }) => Promise<void>;
};

export type AccountDeletionLogger = {
  info?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};
