import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  confidence,
  followupStatus,
  interactionType,
  messageDraftChannel,
  messageDraftPurpose,
  messageDraftStatus,
  sourceType,
} from "./enums";
import { people } from "./people";
import { sourceRecords } from "./source-records";

export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    interactionType: interactionType("interaction_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    source: sourceType("source").notNull().default("manual"),
    confidence: confidence("confidence").notNull().default("medium"),
    ...timestamps,
  },
  (table) => [
    index("interactions_person_id_idx").on(table.personId),
    index("interactions_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const followups = pgTable(
  "followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: followupStatus("status").notNull().default("open"),
    cadence: text("cadence"),
    // Source grounding for suggested follow-ups; null for user-created reminders.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    lastPromptedAt: timestamp("last_prompted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("followups_person_id_idx").on(table.personId),
    index("followups_owner_due_idx").on(table.ownerUserId, table.dueAt),
    index("followups_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const messageDrafts = pgTable(
  "message_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: messageDraftChannel("channel").notNull().default("text"),
    purpose: messageDraftPurpose("purpose").notNull().default("other"),
    body: text("body").notNull(),
    status: messageDraftStatus("status").notNull().default("draft"),
    ...timestamps,
  },
  (table) => [
    index("message_drafts_person_id_idx").on(table.personId),
    index("message_drafts_owner_user_id_idx").on(table.ownerUserId),
  ],
);
