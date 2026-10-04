import type { CeilingOverride } from "@tendnote/db/queries/account-ceiling-overrides";
import type { UsagePeriod } from "@tendnote/domain/usage-bounds";
import type { AccountCeilingOverrideDependencies } from "./account-ceiling-override";

/**
 * The Account Ceiling override records over one account's Usage Period, read
 * the way the Drizzle store reads them: a retried raise finds its own record,
 * and an override is in force only in the period it was granted in.
 */
export function createCeilingOverridesFake(input: { period: UsagePeriod | null }) {
  const overrides: CeilingOverride[] = [];
  const ceilings: AccountCeilingOverrideDependencies["ceilings"] = {
    readUsagePeriod: async () => input.period,
    readCeilingOverrides: async ({ userId, period }) => {
      const inForce: Partial<Record<CeilingOverride["costCategory"], number>> = {};
      for (const each of overrides) {
        if (each.userId !== userId || each.periodStart !== period.start) continue;
        inForce[each.costCategory] = Math.max(
          inForce[each.costCategory] ?? 0,
          each.ceilingMicroUsd,
        );
      }
      return inForce;
    },
    recordCeilingOverride: async ({ period, ...raise }) => {
      const existing = overrides.find(
        (each) =>
          each.userId === raise.userId &&
          each.costCategory === raise.costCategory &&
          each.periodStart === period.start &&
          each.ceilingMicroUsd === raise.ceilingMicroUsd,
      );
      if (existing) return existing;
      const override = {
        id: `override_${overrides.length + 1}`,
        ...raise,
        periodStart: period.start,
        expiresOn: period.resetsOn,
      };
      overrides.push(override);
      return override;
    },
  };
  return { ceilings, overrides };
}
