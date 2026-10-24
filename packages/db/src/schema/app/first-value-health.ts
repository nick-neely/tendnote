import type { FirstValueHealthState } from "@tendnote/domain/operator-alerts";
import { jsonb, pgTable, text } from "drizzle-orm/pg-core";

/** One locked row serializes the bounded First Value window and its episode writes. */
export const firstValueHealth = pgTable("first_value_health", {
  id: text("id").primaryKey(),
  state: jsonb("state").$type<FirstValueHealthState>().notNull(),
});
