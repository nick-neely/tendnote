import { bigint, date, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { costCategory } from "./enums";

/**
 * The Usage Ledger (ADR 0246): a per-account daily rollup of hosted model
 * calls, written only by the model-call entry point. It is content-free by
 * construction - no prompt, reply, record id, or person - so it can say how
 * much an account used, never what Eve was asked. Rows older than the
 * retention constant are swept.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The UTC calendar day the calls were made. */
    day: date("day").notNull(),
    modelId: text("model_id").notNull(),
    costCategory: costCategory("cost_category").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    callCount: integer("call_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: "usage_ledger_pkey",
      columns: [table.userId, table.day, table.modelId, table.costCategory],
    }),
    index("usage_ledger_day_idx").on(table.day),
  ],
);
