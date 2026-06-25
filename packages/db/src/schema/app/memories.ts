import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { confidence, memoryStatus, memoryType, privacyScope, sensitivity } from "./enums";
import { people } from "./people";
import { sourceRecords } from "./source-records";

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    memoryType: memoryType("memory_type").notNull().default("context"),
    content: text("content").notNull(),
    status: memoryStatus("status").notNull().default("suggested"),
    importance: integer("importance").notNull().default(3),
    sensitivity: sensitivity("sensitivity").notNull().default("normal"),
    confidence: confidence("confidence").notNull().default("medium"),
    scope: privacyScope("scope").notNull().default("private"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("memories_person_id_idx").on(table.personId),
    index("memories_owner_user_id_idx").on(table.ownerUserId),
    index("memories_source_record_id_idx").on(table.sourceRecordId),
    index("memories_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);
