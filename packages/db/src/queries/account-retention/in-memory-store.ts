import { dueDeletionNotice } from "@tendnote/domain";
import type { AccountRetentionStore, RetentionAccount } from "./types";

type HeldDeadline = Omit<RetentionAccount, "sentNotice">;

/**
 * The retention store without a database: each account's current deadline,
 * the notices recorded against it, the sweep's attempts, and the purge intents
 * claimed. `resubscribe` clears a deadline the way a grant does.
 */
export function createInMemoryAccountRetentionStore() {
  const deadlines = new Map<string, HeldDeadline>();
  const notices = new Map<string, Pick<RetentionAccount, "retentionDeadline" | "sentNotice">>();
  const intents = new Set<string>();
  const attempts = new Map<string, number>();
  const legalHolds = new Map<string, Date>();

  function isHeld(userId: string, now: Date): boolean {
    return (legalHolds.get(userId)?.getTime() ?? Number.NEGATIVE_INFINITY) > now.getTime();
  }

  function sentFor(account: HeldDeadline): RetentionAccount["sentNotice"] {
    const notice = notices.get(account.userId);
    return notice?.retentionDeadline.getTime() === account.retentionDeadline.getTime()
      ? notice.sentNotice
      : null;
  }

  const store: AccountRetentionStore = {
    async listDue({ now, limit }) {
      return [...deadlines.values()]
        .filter((account) => !intents.has(account.userId) && !isHeld(account.userId, now))
        .map((account) => ({ ...account, sentNotice: sentFor(account) }))
        .filter(
          (account) =>
            now.getTime() >= account.retentionDeadline.getTime() ||
            dueDeletionNotice({
              sent: account.sentNotice,
              deadline: account.retentionDeadline,
              now,
            }) !== null,
        )
        .sort(
          (a, b) =>
            (attempts.get(a.userId) ?? Number.NEGATIVE_INFINITY) -
              (attempts.get(b.userId) ?? Number.NEGATIVE_INFINITY) ||
            a.retentionDeadline.getTime() - b.retentionDeadline.getTime(),
        )
        .slice(0, limit);
    },

    async markAttempted({ userId, at }) {
      attempts.set(userId, at.getTime());
    },

    async recordNotice({ userId, retentionDeadline, stage }) {
      notices.set(userId, { retentionDeadline, sentNotice: stage });
    },

    async claimPurge({ userId, retentionDeadline, now }) {
      const held = deadlines.get(userId);
      if (!held || held.retentionDeadline.getTime() !== retentionDeadline.getTime()) return false;
      if (retentionDeadline.getTime() > now.getTime() || intents.has(userId)) return false;
      if (isHeld(userId, now)) return false;
      intents.add(userId);
      return true;
    },
  };

  return {
    ...store,
    hold(account: HeldDeadline) {
      deadlines.set(account.userId, account);
    },
    /** A Legal Hold on the account's data until `expiresAt`. */
    placeLegalHold(userId: string, expiresAt: Date) {
      legalHolds.set(userId, expiresAt);
    },
    resubscribe(userId: string) {
      deadlines.delete(userId);
      attempts.delete(userId);
    },
    hasIntent(userId: string) {
      return intents.has(userId);
    },
  };
}
