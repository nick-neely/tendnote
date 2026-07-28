import type { Followup, FollowupStatus, RecordSurfacingState } from "@tendnote/domain";
import { parseLocalCalendarDate } from "@tendnote/domain/local-calendar-dates";
import { visibilityChoiceForScope } from "@tendnote/domain/privacy";
import { formatSurfacingDay, resolveRecordSurfacing } from "@tendnote/domain/record-surfacing";
import type { ReminderScheduleView } from "@/lib/reminder-schedule-view";

/**
 * Where a follow-up sits relative to now, so the profile and dashboard can make
 * due and overdue reminders easy to spot (PRD #42, issue #44/#45) without turning
 * the surface into a task feed.
 */
export type FollowupDueState = Extract<RecordSurfacingState, "overdue" | "today" | "upcoming">;

export type FollowupView = {
  id: string;
  revision: string;
  reason: string;
  status: FollowupStatus;
  ownerUserId: string;
  owned: boolean;
  /** ISO timestamp for client-side date inputs (snooze/edit), kept exact. */
  dueAtISO: string;
  /** `YYYY-MM-DD` for a date input's default value, in local time. */
  dueAtDate: string;
  dueLabel: string;
  dueState: FollowupDueState;
  surfaceLabel: string;
  visibilityChoice: ReturnType<typeof visibilityChoiceForScope>;
  visibilityLabel: string;
  reminderSchedule?: ReminderScheduleView | null;
};

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a date input's `YYYY-MM-DD` value to local midnight, over the shared calendar
 * date parser — the one place that conversion lives, so the day can never shift here and
 * hold elsewhere (issue #44). This wrapper adds only the throwing contract its callers
 * rely on, distinguishing a malformed shape from an impossible date.
 */
export function parseDateInputValue(value: string): Date {
  if (!DATE_INPUT_PATTERN.test(value)) {
    throw new Error("Expected a YYYY-MM-DD date.");
  }

  const date = parseLocalCalendarDate(value);
  if (!date) {
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

/**
 * Maps a persisted follow-up to a serializable view for client components. Dates
 * are pre-resolved (label + date-input value) so the client never re-derives
 * timezones, and `dueState` is computed once server-side (PRD #42).
 */
export function toFollowupView(
  followup: Followup & {
    sharedWithCount?: number;
    householdName?: string | null;
  },
  now: Date = new Date(),
  reminderSchedule: ReminderScheduleView | null = null,
  callerUserId: string = followup.ownerUserId,
): FollowupView {
  const surfacing = resolveRecordSurfacing(
    {
      kind: "followup",
      status: followup.status,
      dueAt: followup.dueAt,
      ownerUserId: followup.ownerUserId,
      viewerUserId: callerUserId,
      scope: followup.scope,
      sharedWithCount: followup.sharedWithCount ?? 0,
      householdName: followup.householdName ?? null,
      updatedAt: followup.updatedAt,
    },
    now,
  );

  return {
    id: followup.id,
    revision: surfacing.revision,
    reason: followup.reason,
    status: followup.status,
    ownerUserId: followup.ownerUserId,
    owned: surfacing.owned,
    dueAtISO: followup.dueAt.toISOString(),
    dueAtDate: toDateInputValue(followup.dueAt),
    dueLabel: formatSurfacingDay(followup.dueAt, now),
    dueState: surfacing.state as FollowupDueState,
    surfaceLabel: surfacing.timingLabel,
    visibilityChoice: visibilityChoiceForScope(followup.scope),
    visibilityLabel: surfacing.audienceLabel,
    reminderSchedule,
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
  callerUserId: string = summary.followup.ownerUserId,
): DashboardFollowupView {
  return {
    ...toFollowupView(summary.followup, now, null, callerUserId),
    personId: summary.followup.personId,
    personName: summary.person?.displayName ?? null,
  };
}
