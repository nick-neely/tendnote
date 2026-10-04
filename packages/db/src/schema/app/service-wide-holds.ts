import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The Service-Wide Hold's audited record (#634): while one is open, the hosted
 * product is offline for every account except the Stripe webhook receiver, and
 * export, deletion, and all background work wait. Placed and lifted only by
 * the operator's hold command. Append-only apart from the one fact learned
 * afterwards: when it was lifted. The reason is the operator's internal note,
 * content-free and never shown to customers. At most one hold is open.
 */
export const serviceWideHolds = pgTable(
  "service_wide_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reason: text("reason").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("service_wide_holds_one_open_idx")
      .on(sql`(${table.liftedAt} is null)`)
      .where(sql`${table.liftedAt} is null`),
  ],
);
