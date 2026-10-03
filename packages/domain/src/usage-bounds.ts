import { type CostCategory, usageLedgerDay } from "./usage-ledger";

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
    /**
     * Interactive Eve: from the Fair-Use Budget, turns run on the Fallback
     * Model; at the Account Ceiling, new turns pause.
     */
    interactive: { fairUseBudgetUsd: number; accountCeilingUsd: number };
    /**
     * Background work: extraction, embeddings, snapshots, and scheduled
     * workflows. It has no cheaper substitute to reduce to, so at the Account
     * Ceiling it pauses: captures wait in their pending state and scheduled
     * workflows skip their next delivery.
     */
    background: { accountCeilingUsd: number };
    /** Eve's web search. No cheaper substitute either, so at the ceiling it pauses. */
    webSearch: { accountCeilingUsd: number };
  };
};

/**
 * The one hosted plan, monthly or annual. Its figures come from
 * `docs/phase-9b/paid-offer-and-price.md`; changing one changes a published
 * promise, so the decision changes first.
 */
export const HOSTED_PLAN = {
  allowance: {
    interactive: { fairUseBudgetUsd: 10.5, accountCeilingUsd: 12 },
    background: { accountCeilingUsd: 1.3 },
    // One hundred searches at the gateway's $0.007 each.
    webSearch: { accountCeilingUsd: 0.7 },
  },
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

/**
 * What an account has spent this Usage Period, per cost category, in millionths
 * of a dollar.
 */
export type PeriodSpend = {
  period: UsagePeriod;
  spentMicroUsd: Record<CostCategory, number>;
};

/**
 * What each metered function shows an account. `background` covers capture
 * processing and scheduled workflows, which pause together at the background
 * ceiling; `search` is the semantic half of search, which shares that allowance.
 */
export type UsageNotices = {
  eve: UsageNotice;
  search: UsageNotice;
  background: UsageNotice;
  webSearch: UsageNotice;
};

/**
 * Refuses a model call whose function is paused at its Account Ceiling until
 * the Usage Period resets. The model-call entry point throws it; a background
 * job that meets it waits in its pending state until `resumesAt`. Its message
 * is safe to show the account's owner.
 */
export class UsagePausedError extends Error {
  readonly resetsOn: string;

  constructor(resetsOn: string) {
    super(
      `This month's limit for background work is reached, so it is paused. ${recoveryText({ kind: "resets_on", date: resetsOn })} ` +
        "Records, reminders, and exact search still work.",
    );
    this.name = "UsagePausedError";
    this.resetsOn = resetsOn;
  }

  /** The start of the reset day, in UTC, which is when the Usage Ledger's new period begins. */
  get resumesAt(): Date {
    return new Date(`${this.resetsOn}T00:00:00Z`);
  }
}

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
 * Whether interactive Eve's spend this Usage Period has reached the plan's
 * Fair-Use Budget, so its turns run on the Fallback Model. It is the spend
 * alone that decides: a service-wide restriction never changes the model.
 */
export function overFairUseBudget(input: { plan: Plan; spentMicroUsd: number }): boolean {
  return (
    input.spentMicroUsd >= input.plan.allowance.interactive.fairUseBudgetUsd * MICRO_USD_PER_USD
  );
}

function atCeiling(spentMicroUsd: number, accountCeilingUsd: number): boolean {
  return spentMicroUsd >= accountCeilingUsd * MICRO_USD_PER_USD;
}

/** Paused at the ceiling until the period resets: the whole story for a function with no substitute. */
function ceilingNotice(input: {
  period: UsagePeriod;
  spentMicroUsd: number;
  accountCeilingUsd: number;
}): UsageNotice {
  return atCeiling(input.spentMicroUsd, input.accountCeilingUsd)
    ? { state: "paused", recovery: { kind: "resets_on", date: input.period.resetsOn } }
    : { state: "normal" };
}

/**
 * Every metered function's notice from what the account has spent this Usage
 * Period, or all normal for an account with no plan. Interactive Eve follows
 * {@link interactiveUsageNotice}. Background work and web search pause at their
 * own ceilings. Search is reduced to exact results while background work is
 * paused, because its query embeddings are charged to the background allowance.
 */
export function usageNotices(input: { plan: Plan; spend: PeriodSpend | null }): UsageNotices {
  if (!input.spend) {
    const normal = { state: "normal" } as const;
    return { eve: normal, search: normal, background: normal, webSearch: normal };
  }

  const { period, spentMicroUsd } = input.spend;
  const { allowance } = input.plan;
  const background = ceilingNotice({
    period,
    spentMicroUsd: spentMicroUsd.background,
    accountCeilingUsd: allowance.background.accountCeilingUsd,
  });
  return {
    eve: interactiveUsageNotice({
      plan: input.plan,
      period,
      spentMicroUsd: spentMicroUsd.interactive,
    }),
    search: background.state === "paused" ? { ...background, state: "reduced" } : background,
    background,
    webSearch: ceilingNotice({
      period,
      spentMicroUsd: spentMicroUsd.web_search,
      accountCeilingUsd: allowance.webSearch.accountCeilingUsd,
    }),
  };
}

/**
 * Interactive Eve's notice from what the account has spent this Usage Period.
 * From the plan's Fair-Use Budget, turns are reduced to the Fallback Model; at
 * its Account Ceiling, new turns pause. Both last until the period resets.
 */
export function interactiveUsageNotice(input: {
  plan: Plan;
  period: UsagePeriod;
  spentMicroUsd: number;
}): UsageNotice {
  const { accountCeilingUsd } = input.plan.allowance.interactive;
  const recovery: RecoveryCondition = { kind: "resets_on", date: input.period.resetsOn };
  const restrictions: UsageRestriction[] = [];
  if (overFairUseBudget(input)) {
    restrictions.push({ state: "reduced", recovery });
  }
  if (atCeiling(input.spentMicroUsd, accountCeilingUsd)) {
    restrictions.push({ state: "paused", recovery });
  }
  return usageNotice(restrictions);
}
