import {
  EVE_USAGE_PAUSED_CODE,
  type RecoveryCondition,
  type UsageNotice,
  type UsageRestriction,
} from "@tendnote/domain/usage-bounds";
import { z } from "zod";

const pausedNoticeSchema = z.object({
  state: z.literal("paused"),
  recovery: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("resets_on"), date: z.iso.date() }),
    z.object({ kind: z.literal("service_restored") }),
    z.object({ kind: z.literal("retrying") }),
  ]),
});

const RESET_DAY = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** The one recovery condition a reduced or paused notice states, as a sentence. */
export function recoveryText(recovery: RecoveryCondition): string {
  switch (recovery.kind) {
    case "resets_on":
      // A calendar day, so it is formatted in UTC rather than shifted into the
      // viewer's zone.
      return `Resets on ${RESET_DAY.format(new Date(`${recovery.date}T00:00:00Z`))}.`;
    case "service_restored":
      return "Resumes when service is restored.";
    case "retrying":
      return "Retrying.";
  }
}

/**
 * What interactive Eve's notice says: over the Fair-Use Budget, that Eve
 * continues on a lighter model (#626); at the Account Ceiling, that it is paused
 * (#625). Each states exactly one recovery condition, the one the notice carries.
 */
export function eveUsageNoticeText(notice: UsageRestriction): {
  headline: string;
  detail: string;
} {
  const monthly = notice.recovery.kind === "resets_on";
  const recovery = recoveryText(notice.recovery);
  if (notice.state === "reduced") {
    return {
      headline: "Eve is using a lighter model.",
      detail: monthly
        ? `You've used this month's full-quality turns, so Eve continues on a lighter model up to the monthly limit. ${recovery}`
        : recovery,
    };
  }
  return {
    headline: monthly ? "Eve has reached this month's usage limit." : "Eve is paused.",
    detail: `Everything else in Tendnote still works. ${recovery}`,
  };
}

/**
 * The paused notice from a turn Eve refused at the door, or `null` for any
 * other failure. It is how a conversation that crosses the ceiling mid-session
 * learns it, since the page's own read was taken before.
 */
export function pausedNoticeFromError(error: unknown): UsageNotice | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, body } = error as { code?: unknown; body?: unknown };
  if (code !== EVE_USAGE_PAUSED_CODE || typeof body !== "string") return null;

  try {
    const parsed = pausedNoticeSchema.safeParse((JSON.parse(body) as { notice?: unknown }).notice);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
