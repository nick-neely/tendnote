import type { Sensitivity } from "@tendnote/domain";
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
