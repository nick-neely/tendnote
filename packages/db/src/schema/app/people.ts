import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { contactMethodType, relationshipType, sourceType } from "./enums";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthday: text("birthday"),
    relationshipType: relationshipType("relationship_type").notNull().default("other"),
    closenessLevel: integer("closeness_level").notNull().default(3),
    profileBlurb: text("profile_blurb"),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("display_name", '') || ' ' || coalesce("first_name", '') || ' ' || coalesce("last_name", '') || ' ' || coalesce("profile_blurb", ''))`,
      ),
    source: sourceType("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    index("people_owner_user_id_idx").on(table.ownerUserId),
    index("people_owner_display_name_idx").on(table.ownerUserId, table.displayName),
    index("people_search_vector_idx").using("gin", table.searchVector),
  ],
);

export const contactMethods = pgTable(
  "contact_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    type: contactMethodType("type").notNull(),
    value: text("value").notNull(),
    displayValue: text("display_value"),
    normalizedValue: text("normalized_value"),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: sourceType("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    index("contact_methods_person_id_idx").on(table.personId),
    index("contact_methods_normalized_value_idx").on(table.type, table.normalizedValue),
  ],
);
