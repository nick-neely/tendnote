import type { ActionSurfacingReason, GeneralAction, Sensitivity } from "@tendnote/domain";
import { zonedWallTimeToUtc } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";

export const DAY_MS = 24 * 60 * 60 * 1_000;

export function localDayBounds(localDate: string, timeZone: string) {
  const parts = localDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error("Today requires a valid local date.");
  }
  const [year, month, day] = parts as [number, number, number];
  const start = zonedWallTimeToUtc({ timeZone, year, month, day, minute: 0 });
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = zonedWallTimeToUtc({
    timeZone,
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    minute: 0,
  });
  return { start, end };
}

export async function sourceSensitivity(
  deps: Pick<TodayCandidateLoaderDeps, "getSourceRecord">,
  ownerUserId: string,
  sourceRecordId: string | null,
): Promise<Sensitivity> {
  if (!sourceRecordId) return "normal";
  return (await deps.getSourceRecord({ ownerUserId, sourceRecordId }))?.sensitivity ?? "restricted";
}

export function formatDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    date,
  );
}

export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function dateOnlyKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/**
 * When a dated Action or Routine is asking for someone, from its own stored
 * dates and the reader's local day.
 *
 * Shared by private Today and the Household home because it is one question with
 * one answer: a record's status and dates decide whether its moment has come,
 * and that cannot mean two different things on two surfaces without one of them
 * lying about the same record.
 *
 * `scheduled` is the branch the two surfaces disagree about, which is why it is
 * returned rather than resolved here. Today drops it — a date that has not
 * arrived is not relevant to me *now* — while the Household home admits it into
 * **Coming up** if it falls inside the household's horizon. Neither decision
 * belongs to the classification; both belong to the surface.
 */
export type DatedActionTiming = {
  code: ActionSurfacingReason | "scheduled";
  /** The instant the code refers to: a due date, or a deferred record's return. */
  at: Date;
};

export function classifyDatedAction(
  action: Pick<GeneralAction, "status" | "dueAt" | "deferUntil">,
  day: { localDate: string; now: Date },
): DatedActionTiming | null {
  if (action.status === "deferred") {
    // A deferred record is deliberately quiet until the day someone chose.
    return action.deferUntil && action.deferUntil.getTime() <= day.now.getTime()
      ? { code: "resurfaced", at: action.deferUntil }
      : null;
  }
  if (action.status !== "open" || !action.dueAt) return null;
  const dueDate = dateOnlyKey(action.dueAt);
  if (dueDate < day.localDate) return { code: "overdue", at: action.dueAt };
  if (dueDate === day.localDate) return { code: "due_today", at: action.dueAt };
  return { code: "scheduled", at: action.dueAt };
}
