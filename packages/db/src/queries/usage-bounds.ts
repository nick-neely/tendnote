import {
  HOSTED_PLAN,
  interactiveUsageNotice,
  type UsageNotice,
  type UsagePeriod,
  usagePeriod,
} from "@tendnote/domain/usage-bounds";
import { usageLedgerDay } from "@tendnote/domain/usage-ledger";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { accessProfiles, usageLedger } from "../schema";

export type { UsageNotice, UsagePeriod };

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
 * What interactive Eve shows this account now: normal, or paused at the plan's
 * Account Ceiling until its Usage Period resets. An account with no
 * subscription anchor has no plan, so no plan-derived ceiling applies to it;
 * that includes every self-hosted account.
 */
export async function readEveUsageNotice(input: {
  userId: string;
  now?: Date;
}): Promise<UsageNotice> {
  const db = getDb();
  const [profile] = await db
    .select({ anchor: accessProfiles.usagePeriodAnchor })
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, input.userId))
    .limit(1);
  if (!profile?.anchor) return { state: "normal" };

  const period = usagePeriod(profile.anchor, input.now ?? new Date());
  const [spent] = await db
    .select({ microUsd: sql<string>`coalesce(sum(${usageLedger.costMicroUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, input.userId),
        eq(usageLedger.costCategory, "interactive"),
        gte(usageLedger.day, period.start),
        lt(usageLedger.day, period.resetsOn),
      ),
    );

  return interactiveUsageNotice({
    plan: HOSTED_PLAN,
    period,
    spentMicroUsd: Number(spent?.microUsd ?? 0),
  });
}
