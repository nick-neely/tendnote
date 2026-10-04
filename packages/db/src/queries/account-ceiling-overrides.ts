import type { CeilingOverrides, UsagePeriod } from "@tendnote/domain/usage-bounds";
import type { CostCategory } from "@tendnote/domain/usage-ledger";
import { and, eq, max } from "drizzle-orm";
import { getDb } from "../client";
import { accountCeilingOverrides } from "../schema";

/** The Account Ceiling override Operator Action's record (#633). */
export type CeilingOverride = {
  id: string;
  userId: string;
  costCategory: CostCategory;
  ceilingMicroUsd: number;
  periodStart: string;
  expiresOn: string;
  grantedAt: Date;
};

/**
 * Raise one cost category's Account Ceiling for the Usage Period `period`,
 * expiring when it resets, or return the record a retry of the same raise
 * already wrote.
 */
export async function recordCeilingOverride(input: {
  userId: string;
  costCategory: CostCategory;
  ceilingMicroUsd: number;
  period: UsagePeriod;
  grantedAt: Date;
}): Promise<CeilingOverride> {
  const { period, ...raise } = input;
  const values = { ...raise, periodStart: period.start, expiresOn: period.resetsOn };
  const db = getDb();
  await db.insert(accountCeilingOverrides).values(values).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(accountCeilingOverrides)
    .where(
      and(
        eq(accountCeilingOverrides.userId, input.userId),
        eq(accountCeilingOverrides.costCategory, input.costCategory),
        eq(accountCeilingOverrides.periodStart, period.start),
        eq(accountCeilingOverrides.ceilingMicroUsd, input.ceilingMicroUsd),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Failed to write the Account Ceiling override.");
  return row;
}

/**
 * The highest raise per cost category granted in the account's current Usage
 * Period `period`. One granted in any other period is not in force: it expired
 * when its own period reset, and a re-anchored period starts without it.
 */
export async function readCeilingOverrides(input: {
  userId: string;
  period: UsagePeriod;
}): Promise<CeilingOverrides> {
  const rows = await getDb()
    .select({
      costCategory: accountCeilingOverrides.costCategory,
      ceilingMicroUsd: max(accountCeilingOverrides.ceilingMicroUsd),
    })
    .from(accountCeilingOverrides)
    .where(
      and(
        eq(accountCeilingOverrides.userId, input.userId),
        eq(accountCeilingOverrides.periodStart, input.period.start),
        eq(accountCeilingOverrides.expiresOn, input.period.resetsOn),
      ),
    )
    .groupBy(accountCeilingOverrides.costCategory);
  const overrides: CeilingOverrides = {};
  for (const row of rows) {
    if (row.ceilingMicroUsd !== null) overrides[row.costCategory] = Number(row.ceilingMicroUsd);
  }
  return overrides;
}
