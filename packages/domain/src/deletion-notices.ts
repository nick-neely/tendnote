/**
 * The deletion-notice sequence for an account with a retention deadline: a
 * Lapsed Account, or a Terminated one (#621). Three content-free notices go out
 * before the deadline and a confirmation after the purge.
 *
 * Each notice is timed from the stored deadline, never from a recomputed entry
 * date, so the notices, the copy, and the purge all read the one instant the
 * account was promised. The first is due as soon as the account has a deadline;
 * with the ninety-day retention the later two fall on days 60 and 83, which is
 * where their names come from.
 */
export const DELETION_NOTICE_STAGES = ["day_0", "day_60", "day_83"] as const;

export type DeletionNoticeStage = (typeof DELETION_NOTICE_STAGES)[number];

/**
 * Why an account holds a retention deadline: its Paid Access ended (Lapsed), or
 * the operator terminated it. Only a Lapsed Account can come back by
 * resubscribing, so only its notices offer that.
 */
export type DeletionNoticeKind = "lapsed" | "terminated";

/** The notices timed against the deadline, and how many days before it each falls due. */
export type TimedDeletionNoticeStage = Exclude<DeletionNoticeStage, "day_0">;

const DUE_DAYS_BEFORE_DEADLINE: Record<TimedDeletionNoticeStage, number> = {
  day_60: 30,
  day_83: 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The latest deadline for which `stage` is due at `now`: an account whose
 * deadline is at or before this instant is owed that notice. The sweep's query
 * compares stored deadlines against it, so it never reads accounts with nothing
 * due.
 */
export function deletionNoticeDueForDeadlinesBy(stage: TimedDeletionNoticeStage, now: Date): Date {
  return new Date(now.getTime() + DUE_DAYS_BEFORE_DEADLINE[stage] * DAY_MS);
}

function isDue(stage: DeletionNoticeStage, deadline: Date, now: Date): boolean {
  if (stage === "day_0") return true;
  return deadline.getTime() <= deletionNoticeDueForDeadlinesBy(stage, now).getTime();
}

/**
 * The notice an account is owed now, given the last one it was sent for this
 * deadline: the latest stage already due, if it is later than `sent`. A sweep
 * that fell behind sends only the latest, never a burst of stale ones, and
 * every notice states the deadline itself. `null` once the deadline has passed:
 * the account is purged, not warned.
 */
export function dueDeletionNotice(input: {
  sent: DeletionNoticeStage | null;
  deadline: Date;
  now: Date;
}): DeletionNoticeStage | null {
  if (input.now.getTime() >= input.deadline.getTime()) return null;
  const sentIndex = input.sent ? DELETION_NOTICE_STAGES.indexOf(input.sent) : -1;
  for (let index = DELETION_NOTICE_STAGES.length - 1; index > sentIndex; index -= 1) {
    const stage = DELETION_NOTICE_STAGES[index] as DeletionNoticeStage;
    if (isDue(stage, input.deadline, input.now)) return stage;
  }
  return null;
}
