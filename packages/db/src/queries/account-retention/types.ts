import type { DeletionNoticeKind, DeletionNoticeStage } from "@tendnote/domain";

/** An account with something due: a notice, or the purge. Ids, an address, and moments. */
export type RetentionAccount = {
  userId: string;
  email: string;
  kind: DeletionNoticeKind;
  retentionDeadline: Date;
  /** The last notice sent for this deadline. One sent for an earlier deadline does not count. */
  sentNotice: DeletionNoticeStage | null;
};

export type AccountRetentionStore = {
  /**
   * Accounts owed a notice or the purge at `now`: never-attempted first, then
   * least recently attempted, earliest deadline breaking ties. An
   * admitted account has no deadline, so resubscribing removes it from here; a
   * terminated account is read by its termination's deadline only; an account
   * already being deleted is left to its intent. An account under a Legal Hold
   * is owed nothing until the hold ends (#632): its notices pause, and resume
   * from the stage they reached.
   */
  listDue: (input: { now: Date; limit: number }) => Promise<RetentionAccount[]>;
  /** Records the sweep taking the account up, for the order above. */
  markAttempted: (input: { userId: string; retentionDeadline: Date; at: Date }) => Promise<void>;
  recordNotice: (input: {
    userId: string;
    retentionDeadline: Date;
    stage: DeletionNoticeStage;
    at: Date;
  }) => Promise<void>;
  /**
   * Commits the account's deletion intent for its passed deadline, in one
   * step that changes nothing unless the account still holds exactly that
   * deadline and no Legal Hold. An account that resubscribed, or was held,
   * after it was listed is therefore never purged. Returns whether an intent
   * was committed.
   */
  claimPurge: (input: { userId: string; retentionDeadline: Date; now: Date }) => Promise<boolean>;
};
