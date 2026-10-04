import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * The Legal Hold Operator Action's record (#632): the account's data may not
 * be purged before `expires_at` (ADR 0260). It blocks that deletion only.
 * Admission, export, billing, and the deletion request itself are untouched,
 * and the deletion notices pause until the hold ends.
 *
 * Append-only. A later hold extends one already in force by adding a second
 * record, and the latest expiry governs. Identifiers and moments only; the
 * matter behind a hold is kept off the product database.
 */
export const legalHolds = pgTable(
  "legal_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A retried hold names the same expiry, so it finds its record.
    uniqueIndex("legal_holds_account_expiry_unique").on(table.userId, table.expiresAt),
  ],
);
