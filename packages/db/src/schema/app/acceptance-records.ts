import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { legalDocumentKey } from "./enums";

/**
 * An Acceptance Record (#613): the fact that an account accepted one version of
 * a hosted legal document. It holds exactly the account, the document, the
 * version, and when - no IP address or other evidence of assent, because the
 * account and the timestamp are what a dispute would actually turn on.
 */
export const acceptanceRecords = pgTable(
  "acceptance_records",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentKey: legalDocumentKey("document_key").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "acceptance_records_pkey",
      columns: [table.userId, table.documentKey, table.version],
    }),
  ],
);
