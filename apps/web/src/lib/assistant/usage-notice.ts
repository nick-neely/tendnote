import {
  EVE_USAGE_PAUSED_CODE,
  recoveryText,
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
 * What background work's notice says when it is paused at the account's
 * background Account Ceiling: captures wait in their pending state and the
 * next scheduled delivery is skipped. Reminders are not background work and are
 * never shed, so they are covered by "everything else".
 */
export function backgroundUsageNoticeText(notice: UsageRestriction): {
  headline: string;
  detail: string;
} {
  const monthly = notice.recovery.kind === "resets_on";
  return {
    headline: monthly ? "Background work is paused for this month." : "Background work is paused.",
    detail: `New captures wait to be processed, and scheduled briefs and reviews skip their next delivery. Everything else in Tendnote still works. ${recoveryText(notice.recovery)}`,
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
