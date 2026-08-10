import { z } from "zod";
import { briefCadenceSchema } from "./briefs";

/**
 * Tendnote-owned brief schedule row (PRD #65, issue #72, ADR-0066). Per-user
 * daily and weekly brief timing lives here — timezone, next run, lease, retry, and
 * enabled state — rather than in static Eve cron files, because Eve schedules are
 * root-only and Vercel evaluates cron in UTC. One static dispatcher wakes on a
 * cadence and atomically claims the due rows; these fields are what it claims.
 */
export const briefScheduleSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  cadence: briefCadenceSchema,
  // IANA timezone (e.g. "America/Los_Angeles") the local run time is resolved in.
  timezone: z.string().min(1),
  // Minutes after local midnight to run (e.g. 480 = 08:00 local).
  runAtMinute: z.number().int().min(0).max(1439),
  // Local weekday (0=Sunday .. 6=Saturday) for the weekly review; null for daily.
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  // The next UTC instant this schedule is due. The dispatcher claims rows whose
  // nextRunAt is in the past and re-derives this on success.
  nextRunAt: z.date(),
  enabled: z.boolean().default(true),
  /**
   * Whether this member has asked for a Household Check-in in their private
   * briefing (#390).
   *
   * It rides the brief schedule because that is literally what the member opts
   * into — "their private daily or weekly briefing" — and because a preference
   * stored beside the thing it modifies cannot drift away from it. Default
   * `false`: a Check-in is offered, never assumed, and nobody may enable one for
   * another member (ADR 0220).
   */
  householdCheckinEnabled: z.boolean().default(false),
  // Lease held while a dispatcher run is generating this brief; null when free.
  // A row is claimable only when its lease is absent or expired (at-least-once).
  leaseExpiresAt: z.date().nullable().default(null),
  // Consecutive failed attempts since the last success; reset on success or when
  // the occurrence is given up and rolled to the next slot.
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
  lastRunAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type BriefSchedule = z.infer<typeof briefScheduleSchema>;

export const createBriefScheduleSchema = briefScheduleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateBriefScheduleInput = z.infer<typeof createBriefScheduleSchema>;

/** The recurrence-defining fields, the subset next-run computation needs. */
export type BriefScheduleRecurrence = Pick<
  BriefSchedule,
  "cadence" | "timezone" | "runAtMinute" | "weekday"
>;

function localParts(timeZone: string, instant: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }

  return parts as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Timezone offset (local − UTC, in ms) at a given instant. */
export function timezoneOffsetMs(timeZone: string, instant: Date): number {
  const p = localParts(timeZone, instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** The UTC instant for a local wall-clock time (date + minutes) in a timezone. */
export function zonedWallTimeToUtc(input: {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  minute: number;
}): Date {
  const hour = Math.floor(input.minute / 60);
  const min = input.minute % 60;
  const guess = Date.UTC(input.year, input.month - 1, input.day, hour, min);
  // Subtract the zone offset at the guessed instant to land on the wall time.
  const offset = timezoneOffsetMs(input.timeZone, new Date(guess));
  return new Date(guess - offset);
}

/** The local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function formatLocalDate(timeZone: string, instant: Date): string {
  const p = localParts(timeZone, instant);
  const month = String(p.month).padStart(2, "0");
  const day = String(p.day).padStart(2, "0");
  return `${p.year}-${month}-${day}`;
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The next UTC instant strictly after `from` when the schedule's local wall-clock
 * time recurs (PRD #65). Daily recurs every local day at `runAtMinute`; weekly
 * recurs on `weekday` at `runAtMinute`. Timezone offsets (incl. DST) are resolved
 * per-candidate-day, so the local time stays stable across transitions.
 */
export function computeNextBriefRun(schedule: BriefScheduleRecurrence, from: Date): Date {
  if (schedule.cadence === "weekly" && schedule.weekday === null) {
    throw new Error("A weekly brief schedule needs a weekday.");
  }

  const origin = localParts(schedule.timezone, from);
  const cursor = Date.UTC(origin.year, origin.month - 1, origin.day);

  // Scan up to two weeks of candidate local dates; one always matches.
  for (let offset = 0; offset < 15; offset += 1) {
    const date = new Date(cursor + offset * 86_400_000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    if (schedule.cadence === "weekly" && weekdayOf(year, month, day) !== schedule.weekday) {
      continue;
    }

    const run = zonedWallTimeToUtc({
      timeZone: schedule.timezone,
      year,
      month,
      day,
      minute: schedule.runAtMinute,
    });
    if (run.getTime() > from.getTime()) {
      return run;
    }
  }

  throw new Error("Could not compute the next brief run time.");
}
