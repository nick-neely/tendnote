import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

/**
 * General Action Areas: flat, owner-scoped life categories (Home, Health, Finance,
 * …) for organizing General Actions (ADR 0146, #179). Deliberately flat — no
 * parent/child column, no permission or tag columns — so Areas stay categories
 * rather than projects, folder trees, or scopes. Owners are seeded with sensible
 * defaults on first use and can rename or archive any Area.
 */
export const generalActionAreas = pgTable(
  "general_action_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Keeps the seeded defaults in their curated order and appends custom Areas
    // after them, so the filter and picker read the same way every visit.
    sortOrder: integer("sort_order").notNull().default(0),
    // Archived Areas drop out of the filter and picker but persist so Actions
    // already filed under one keep their Area — archive is not delete (ADR 0146).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("general_action_areas_owner_sort_idx").on(table.ownerUserId, table.sortOrder),
    index("general_action_areas_owner_archived_idx").on(table.ownerUserId, table.archivedAt),
    // Distinct active Area names per owner, enforced at the DB so a race between the
    // lifecycle's list-then-check guard can't create duplicates. Partial (active
    // only) and case-insensitive, matching `normalizeAreaName`, so an archived name
    // is free to reuse. The lifecycle translates a violation into the friendly
    // name-collision error (ADR 0146).
    uniqueIndex("general_action_areas_owner_name_active_idx")
      .on(table.ownerUserId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
  ],
);
