import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { visibilityRecordKind } from "./enums";
import { householdWorkspaces } from "./households";

/**
 * A minimal, record-local name for an external person on a household-native
 * coordination record.
 *
 * There is deliberately **no `person_id` column**, and no foreign key to
 * `people`. That absence is the acceptance criterion, not an omission: a
 * Person Reference that could point at a Person row would be one join away from
 * another member's private People graph, and the moment such a column exists,
 * some future read path will follow it. What crosses instead is a label an
 * authorized member typed onto this one record (ADR 0218).
 *
 * There is likewise no scope or audience: a reference inherits the containing
 * record's visibility exactly, so it cannot be shared, hidden, or re-addressed
 * separately from the record it annotates.
 *
 * `record_id` is an untyped uuid for the same reason `household_record_shares`
 * uses one — the containing record can belong to any household-native family,
 * and a real foreign key would need one nullable column per family.
 */
export const personReferences = pgTable(
  "person_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    recordKind: visibilityRecordKind("record_kind").notNull(),
    recordId: uuid("record_id").notNull(),
    label: text("label").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    /**
     * One label per record. Naming the same person twice on one plan is
     * duplication, never two facts.
     *
     * Note what is *not* indexed: `label` alone. Without that index there is no
     * cheap access path from a name to the records that mention it, so the
     * table cannot quietly become a household-wide people search.
     */
    uniqueIndex("person_references_record_label_idx").on(
      table.recordKind,
      table.recordId,
      table.label,
    ),
    /** Dissolution and recovery sweep by household. */
    index("person_references_household_idx").on(table.householdId),
  ],
);
