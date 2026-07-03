import type { Followup, FollowupStatus } from "@tendnote/domain";
import { visibilityChoiceForScope, visibilityLabelForScope } from "@tendnote/domain/privacy";

/**
 * Where a follow-up sits relative to now, so the profile and dashboard can make
 * due and overdue reminders easy to spot (PRD #42, issue #44/#45) without turning
 * the surface into a task feed.
 */
export type FollowupDueState = "overdue" | "today" | "upcoming";

export type FollowupView = {
  id: string;
  reason: string;
  status: FollowupStatus;
  /** ISO timestamp for client-side date inputs (snooze/edit), kept exact. */
  dueAtISO: string;
  /** `YYYY-MM-DD` for a date input's default value, in local time. */
  dueAtDate: string;
  dueLabel: string;
  dueState: FollowupDueState;
  visibilityChoice: ReturnType<typeof visibilityChoiceForScope>;
  visibilityLabel: string;
};

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a date input's `YYYY-MM-DD` value to local midnight. Date inputs carry no
 * timezone, so resolving them with `new Date(str)` (UTC midnight) and then reading
 * the parts in local time shifts the day backward west of UTC. Constructing a
 * local Date keeps the chosen calendar day stable end to end (issue #44).
 */
export function parseDateInputValue(value: string): Date {
  if (!DATE_INPUT_PATTERN.test(value)) {
    throw new Error("Expected a YYYY-MM-DD date.");
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Expected a valid date.");
  }

  return date;
}

/** `YYYY-MM-DD` in local time, for seeding a date input's default value. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function followupDueState(dueAt: Date, now: Date = new Date()): FollowupDueState {
  const due = startOfDay(dueAt);
  const today = startOfDay(now);

  if (due < today) {
    return "overdue";
  }
  if (due === today) {
    return "today";
  }
  return "upcoming";
}

/**
 * Maps a persisted follow-up to a serializable view for client components. Dates
 * are pre-resolved (label + date-input value) so the client never re-derives
 * timezones, and `dueState` is computed once server-side (PRD #42).
 */
export function toFollowupView(followup: Followup, now: Date = new Date()): FollowupView {
  const dueState = followupDueState(followup.dueAt, now);
  const dueLabel = followup.dueAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: followup.dueAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });

  return {
    id: followup.id,
    reason: followup.reason,
    status: followup.status,
    dueAtISO: followup.dueAt.toISOString(),
    dueAtDate: toDateInputValue(followup.dueAt),
    dueLabel,
    dueState,
    visibilityChoice: visibilityChoiceForScope(followup.scope),
    visibilityLabel: visibilityLabelForScope(followup.scope),
  };
}

/** A dashboard follow-up: the view plus the person it belongs to (named, not id). */
export type DashboardFollowupView = FollowupView & {
  personId: string;
  personName: string | null;
};

export function toDashboardFollowupView(
  summary: { followup: Followup; person: { id: string; displayName: string } | null },
  now: Date = new Date(),
): DashboardFollowupView {
  return {
    ...toFollowupView(summary.followup, now),
    personId: summary.followup.personId,
    personName: summary.person?.displayName ?? null,
  };
}
