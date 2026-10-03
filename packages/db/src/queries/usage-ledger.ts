import {
  type CostCategory,
  usageLedgerCutoffDay,
  usageLedgerDay,
} from "@tendnote/domain/usage-ledger";
import { lt, sql } from "drizzle-orm";
import { getDb, withoutDatabaseTransaction } from "../client";
import { usageLedger } from "../schema";

/**
 * What one metered model call adds to the Usage Ledger. The fields are the
 * whole of it: nothing about what was asked, answered, or touched.
 */
export type ModelUsage = {
  accountId: string;
  modelId: string;
  costCategory: CostCategory;
  inputTokens: number;
  outputTokens: number;
  /** What the gateway charged, in millionths of a dollar. */
  costMicroUsd: number;
};

/**
 * Add one call to its account's row for today, model, and cost category.
 *
 * It commits on its own even when the call ran inside an owner's transaction:
 * the tokens were spent whether or not that transaction later rolls back. A
 * failure is logged and swallowed, so metering can never fail the call it
 * meters.
 */
export async function recordModelUsage(usage: ModelUsage, now = new Date()) {
  try {
    await withoutDatabaseTransaction(() =>
      getDb()
        .insert(usageLedger)
        .values({
          userId: usage.accountId,
          day: usageLedgerDay(now),
          modelId: usage.modelId,
          costCategory: usage.costCategory,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costMicroUsd: usage.costMicroUsd,
          callCount: 1,
        })
        .onConflictDoUpdate({
          target: [
            usageLedger.userId,
            usageLedger.day,
            usageLedger.modelId,
            usageLedger.costCategory,
          ],
          set: {
            inputTokens: sql`${usageLedger.inputTokens} + excluded.input_tokens`,
            outputTokens: sql`${usageLedger.outputTokens} + excluded.output_tokens`,
            costMicroUsd: sql`${usageLedger.costMicroUsd} + excluded.cost_micro_usd`,
            callCount: sql`${usageLedger.callCount} + 1`,
          },
        }),
    );
  } catch (error) {
    // Only the error's code: a query error carries its parameters, the account id among them.
    console.warn("usage-ledger: could not record a model call", {
      modelId: usage.modelId,
      costCategory: usage.costCategory,
      reason: errorCode(error),
    });
  }
}

function errorCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === "string") return cause.code;
  return error instanceof Error ? error.name : "unknown";
}

/** Delete the days older than the Usage Ledger's retention constant. */
export async function sweepUsageLedger(now = new Date()) {
  const deleted = await getDb()
    .delete(usageLedger)
    .where(lt(usageLedger.day, usageLedgerCutoffDay(now)))
    .returning({ day: usageLedger.day });

  return { deleted: deleted.length };
}
