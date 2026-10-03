import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * Operator-granted Admission Exceptions (ADR 0248): append-only records, each
 * naming the one event of one kind of block it excepts, such as the dispute a
 * re-admission grant resolves (#617). Never edited or reused; a new event needs
 * a new record.
 */
export const admissionExceptions = pgTable(
  "admission_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockKind: text("block_kind").$type<"dispute">().notNull(),
    event: text("event").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("admission_exceptions_block_event_unique").on(table.blockKind, table.event)],
);
