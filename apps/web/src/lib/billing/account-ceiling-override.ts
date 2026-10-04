import type { CeilingOverride } from "@tendnote/db/queries/account-ceiling-overrides";
import type { RecoveryJournal } from "@tendnote/domain";
import {
  type CeilingOverrides,
  HOSTED_PLAN,
  MICRO_USD_PER_USD,
  planCeilingMicroUsd,
  type UsagePeriod,
  withCeilingOverrides,
} from "@tendnote/domain/usage-bounds";
import { COST_CATEGORIES, type CostCategory } from "@tendnote/domain/usage-ledger";

/** What the Account Ceiling override Operator Action touches (#633): the account's period, its overrides, and the journal. */
export type AccountCeilingOverrideDependencies = {
  journal: RecoveryJournal;
  ceilings: {
    readUsagePeriod: (input: { userId: string; now?: Date }) => Promise<UsagePeriod | null>;
    readCeilingOverrides: (input: {
      userId: string;
      period: UsagePeriod;
    }) => Promise<CeilingOverrides>;
    recordCeilingOverride: (input: {
      userId: string;
      costCategory: CostCategory;
      ceilingMicroUsd: number;
      period: UsagePeriod;
      grantedAt: Date;
    }) => Promise<CeilingOverride>;
  };
};

function isCostCategory(value: string): value is CostCategory {
  return (COST_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Raise the Account Ceiling for the current period (#633). The override
 * raises one cost category's ceiling to `ceilingUsd` for the Usage Period
 * running now and expires when that period resets, so the next period starts
 * at the plan's ceiling again. It is written, then journaled; usage reads
 * apply it from the moment it commits. Nothing reaches Stripe.
 *
 * It only raises: a figure at or below the ceiling in force is refused, except
 * the one a retry already recorded, which is journaled again.
 */
export async function raiseAccountCeiling(
  deps: AccountCeilingOverrideDependencies,
  input: { userId: string; category: string; ceilingUsd: number; now?: Date },
) {
  const { category } = input;
  if (!isCostCategory(category)) {
    throw new Error(`A cost category is one of ${COST_CATEGORIES.join(", ")}.`);
  }
  const ceilingMicroUsd = Math.round(input.ceilingUsd * MICRO_USD_PER_USD);
  if (!Number.isSafeInteger(ceilingMicroUsd)) {
    throw new Error("An Account Ceiling is an amount in dollars, such as 20 or 1.75.");
  }
  const now = input.now ?? new Date();
  const period = await deps.ceilings.readUsagePeriod({ userId: input.userId, now });
  if (!period)
    throw new Error(`Account ${input.userId} has no Usage Period to raise a ceiling in.`);

  const overrides = await deps.ceilings.readCeilingOverrides({ userId: input.userId, period });
  const inForce = planCeilingMicroUsd(withCeilingOverrides(HOSTED_PLAN, overrides), category);
  if (ceilingMicroUsd <= inForce && overrides[category] !== ceilingMicroUsd) {
    throw new Error(
      `The ${category} Account Ceiling is already $${(inForce / MICRO_USD_PER_USD).toFixed(2)} this period; an override only raises it.`,
    );
  }

  const override = await deps.ceilings.recordCeilingOverride({
    userId: input.userId,
    costCategory: category,
    ceilingMicroUsd,
    period,
    grantedAt: now,
  });
  await deps.journal.write({
    kind: "ceiling-override",
    accountId: input.userId,
    actionId: override.id,
    at: override.grantedAt,
  });
  return {
    overrideId: override.id,
    costCategory: override.costCategory,
    ceilingUsd: override.ceilingMicroUsd / MICRO_USD_PER_USD,
    expiresOn: override.expiresOn,
  };
}
