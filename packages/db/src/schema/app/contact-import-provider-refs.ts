import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { people } from "./people";

export const contactImportProviderRefs = pgTable(
  "contact_import_provider_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    providerContactId: text("provider_contact_id").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contact_import_provider_refs_owner_idx").on(table.ownerUserId),
    index("contact_import_provider_refs_person_idx").on(table.personId),
    uniqueIndex("contact_import_provider_refs_provider_contact_idx").on(
      table.ownerUserId,
      table.providerKey,
      table.providerContactId,
    ),
  ],
);
