import { usageLedgerDay } from "./usage-ledger";

/**
 * Usage bounds for hosted accounts (spec #591, ADR 0246): the plan's
 * allowance, the Usage Period it is counted over, and the notice a customer
 * sees when a function is reduced or paused.
 */

/**
 * What a plan allows per Usage Period, in dollars of hosted inference. The
 * allowance belongs to the plan rather than to a constant, so a later plan can
 * carry different numbers. Only the limits Tendnote enforces are listed.
 */
export type Plan = {
  allowance: {
    /** Interactive Eve: new turns pause at the Account Ceiling. */
    interactive: { accountCeilingUsd: number };
  };
};

/**
 * The one hosted plan, monthly or annual. Its figures come from
 * `docs/phase-9b/paid-offer-and-price.md`; changing one changes a published
 * promise, so the decision changes first.
 */
export const HOSTED_PLAN = {
  allowance: { interactive: { accountCeilingUsd: 12 } },
} as const satisfies Plan;

const MICRO_USD_PER_USD = 1_000_000;

/**
 * The month an allowance is counted over: from the anchor day (inclusive) to
 * the next one, as UTC `YYYY-MM-DD` days to match the Usage Ledger's days.
 */
export type UsagePeriod = { start: string; resetsOn: string };

/** The one condition a reduced or paused notice says it is waiting for. */
export type RecoveryCondition =
  /** The Usage Period resets: the Fair-Use Budget and the Account Ceiling. */
  | { kind: "resets_on"; date: string }
  /** No date: the Spend Breaker or an operator-declared incident. */
  | { kind: "service_restored" }
  /** Only when a queued job has a scheduled retry. */
  | { kind: "retrying" };

export type UsageRestriction = { state: "reduced" | "paused"; recovery: RecoveryCondition };

/** What one metered function shows: normal, or a restriction with exactly one recovery condition. */
export type UsageNotice = { state: "normal" } | UsageRestriction;

/** The code Eve's door refuses a new turn with while interactive Eve is paused (ADR 0252). */
export const EVE_USAGE_PAUSED_CODE = "eve_usage_paused";

function utcDay(year: number, monthIndex: number, anchorDay: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(anchorDay, lastDay)));
}

/**
 * The Usage Period `now` falls in. It is anchored to the day of the month the
 * subscription started, for monthly and annual subscribers alike: not the
 * calendar month and not the payment provider's billing period. An anchor past
 * the end of a shorter month falls on that month's last day.
 */
export function usagePeriod(anchor: string, now: Date): UsagePeriod {
  const anchorDay = Number(anchor.slice(8, 10));
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const thisMonth = utcDay(year, month, anchorDay);
  const startMonth = now >= thisMonth ? month : month - 1;
  return {
    start: usageLedgerDay(utcDay(year, startMonth, anchorDay)),
    resetsOn: usageLedgerDay(utcDay(year, startMonth + 1, anchorDay)),
  };
}

const RECOVERY_PRECEDENCE: Record<RecoveryCondition["kind"], number> = {
  // While the service-wide restriction applies, no billing date is shown.
  service_restored: 2,
  resets_on: 1,
  retrying: 0,
};

/** The condition that has to hold before every restriction in the group clears. */
function longestRecovery(a: RecoveryCondition, b: RecoveryCondition): RecoveryCondition {
  if (a.kind === "resets_on" && b.kind === "resets_on") return a.date >= b.date ? a : b;
  return RECOVERY_PRECEDENCE[a.kind] >= RECOVERY_PRECEDENCE[b.kind] ? a : b;
}

/**
 * The notice for one function from every restriction currently on it: the most
 * restrictive state and exactly one recovery condition for that state. Callers
 * pass what applies now, so the notice is recomputed as each restriction clears.
 */
export function usageNotice(restrictions: readonly UsageRestriction[]): UsageNotice {
  const paused = restrictions.filter((restriction) => restriction.state === "paused");
  const governing = paused.length > 0 ? paused : restrictions;
  const [first, ...rest] = governing;
  if (!first) return { state: "normal" };

  return {
    state: first.state,
    recovery: rest.reduce(
      (recovery, next) => longestRecovery(recovery, next.recovery),
      first.recovery,
    ),
  };
}

/**
 * Interactive Eve's notice from what the account has spent this Usage Period.
 * At the plan's Account Ceiling, new turns pause until the period resets.
 */
export function interactiveUsageNotice(input: {
  plan: Plan;
  period: UsagePeriod;
  spentMicroUsd: number;
}): UsageNotice {
  const ceilingMicroUsd = input.plan.allowance.interactive.accountCeilingUsd * MICRO_USD_PER_USD;
  const restrictions: UsageRestriction[] =
    input.spentMicroUsd >= ceilingMicroUsd
      ? [{ state: "paused", recovery: { kind: "resets_on", date: input.period.resetsOn } }]
      : [];
  return usageNotice(restrictions);
}
