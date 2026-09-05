import type { PersonUpdateChange } from "@tendnote/domain";
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { people } from "./people";

/** One inverse per person, removed by person/owner erasure. Consumed rows keep only a receipt. */
export const personUpdates = pgTable("person_updates", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => people.id, { onDelete: "cascade" }),
  updateId: uuid("update_id").notNull(),
  expectedUpdatedAt: timestamp("expected_updated_at", { withTimezone: true }).notNull(),
  changes: jsonb("changes").$type<PersonUpdateChange[]>().notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
});
