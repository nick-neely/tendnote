import {
  HOSTED_PLAN,
  overFairUseBudget,
  type PeriodSpend,
  type UsageNotice,
  type UsageNotices,
  type UsagePeriod,
  usageNotices,
  usagePeriod,
  withCeilingOverrides,
} from "@tendnote/domain/usage-bounds";
import { COST_CATEGORIES, usageLedgerDay } from "@tendnote/domain/usage-ledger";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { accessProfiles, usageLedger } from "../schema";
import { readCeilingOverrides } from "./account-ceiling-overrides";
import { readSpendBreakerStage, type SpendBreakerStage } from "./spend-breaker";

export type { UsageNotice, UsageNotices, UsagePeriod };

/**
 * Anchor the account's Usage Period to the day its subscription started.
 * Written from each subscription's first paid invoice, so a resubscription
 * re-anchors and a redelivered invoice writes the same day again. It only moves
 * forward: Stripe may deliver an older subscription's invoice late, and that
 * must not drag the period back to a start it no longer has. An account
 * with no Access Profile throws rather than going unanchored, which would leave
 * a paying account with no ceiling.
 */
export async function anchorUsagePeriod(input: { userId: string; startedAt: Date }) {
  const anchored = await getDb()
    .update(accessProfiles)
    .set({
      usagePeriodAnchor: sql`greatest(${accessProfiles.usagePeriodAnchor}, ${usageLedgerDay(input.startedAt)}::date)`,
    })
    .where(eq(accessProfiles.userId, input.userId))
    .returning({ userId: accessProfiles.userId });
  if (anchored.length === 0) {
    throw new Error("No Access Profile to anchor the Usage Period to.");
  }
}

/**
 * The Usage Period `now` falls in for this account, or `null` for an account
 * with no subscription anchor: it has no plan, so no plan-derived budget or
 * ceiling applies to it, and that includes every self-hosted account.
 */
export async function readUsagePeriod(input: {
  userId: string;
  now?: Date;
}): Promise<UsagePeriod | null> {
  const [profile] = await getDb()
    .select({ anchor: accessProfiles.usagePeriodAnchor })
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, input.userId))
    .limit(1);
  return profile?.anchor ? usagePeriod(profile.anchor, input.now ?? new Date()) : null;
}

/** What the account has spent in `period` in each cost category, from one read of the Usage Ledger. */
async function readPeriodSpend(userId: string, period: UsagePeriod): Promise<PeriodSpend> {
  const rows = await getDb()
    .select({
      costCategory: usageLedger.costCategory,
      microUsd: sql<string>`coalesce(sum(${usageLedger.costMicroUsd}), 0)`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        gte(usageLedger.day, period.start),
        lt(usageLedger.day, period.resetsOn),
      ),
    )
    .groupBy(usageLedger.costCategory);

  const spentMicroUsd = Object.fromEntries(
    COST_CATEGORIES.map((category) => [category, 0]),
  ) as PeriodSpend["spentMicroUsd"];
  for (const row of rows) spentMicroUsd[row.costCategory] = Number(row.microUsd);
  return { period, spentMicroUsd };
}

/**
 * What every metered function shows this account now: interactive Eve, search,
 * background work (capture processing), scheduled workflows, and web search,
 * from the account's own ceilings, as the operator raised them for this Usage
 * Period (#633), and the Spend Breaker together.
 */
export async function readUsageNotices(input: {
  userId: string;
  now?: Date;
}): Promise<UsageNotices> {
  const [planned, breaker] = await Promise.all([
    readPlannedSpend(input),
    readBreakerOrClosed(input.now),
  ]);
  return usageNotices({
    plan: planned?.plan ?? HOSTED_PLAN,
    spend: planned?.spend ?? null,
    breaker,
  });
}

/**
 * The account's spend this Usage Period and its plan with this period's raised
 * ceilings, or `null` for an account with no Usage Period.
 */
async function readPlannedSpend(input: { userId: string; now?: Date }) {
  const period = await readUsagePeriod(input);
  if (!period) return null;
  const [spend, overrides] = await Promise.all([
    readPeriodSpend(input.userId, period),
    readCeilingOverrides({ userId: input.userId, period }),
  ]);
  return { spend, plan: withCeilingOverrides(HOSTED_PLAN, overrides) };
}

/**
 * The Spend Breaker's stage, or closed when it cannot be read, so a broken
 * breaker never takes the account's own ceilings down with it. Each ceiling
 * still fails the way its door chose; the log is how the gap shows.
 */
async function readBreakerOrClosed(now: Date | undefined): Promise<SpendBreakerStage> {
  try {
    return await readSpendBreakerStage({ now });
  } catch (error) {
    console.error("spend_breaker.read_failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return "closed";
  }
}

/**
 * What interactive Eve shows this account now: normal; reduced to the Fallback
 * Model from the plan's Fair-Use Budget; paused at its Account Ceiling until
 * its Usage Period resets; or paused by the Spend Breaker until service is
 * restored.
 */
export async function readEveUsageNotice(input: {
  userId: string;
  now?: Date;
}): Promise<UsageNotice> {
  return (await readUsageNotices(input)).eve;
}

/** Whether the account's interactive turns run on the Fallback Model now. */
export async function readEveOverFairUseBudget(input: {
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const period = await readUsagePeriod(input);
  if (!period) return false;
  const spend = await readPeriodSpend(input.userId, period);
  return overFairUseBudget({ plan: HOSTED_PLAN, spentMicroUsd: spend.spentMicroUsd.interactive });
}
