import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";

/** Private bytes live in Blob. This row is the authority to read one chat upload. */
export const fileUploads = pgTable("file_uploads", {
  id: uuid("id").primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  pathname: text("pathname").notNull().unique(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  ready: boolean("ready").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A database trigger records every deletion, including cascades, for retryable Blob cleanup. */
export const blobDeletions = pgTable("blob_deletions", {
  pathname: text("pathname").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
