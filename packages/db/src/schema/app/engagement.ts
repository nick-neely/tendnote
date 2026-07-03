import type { DraftSourceRef } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  confidence,
  followupStatus,
  interactionType,
  messageDraftChannel,
  messageDraftPurpose,
  messageDraftStatus,
  privacyScope,
  sourceType,
} from "./enums";
import { householdWorkspaces } from "./households";
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
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    scope: privacyScope("scope").notNull().default("private"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("followups_person_id_idx").on(table.personId),
    index("followups_owner_due_idx").on(table.ownerUserId, table.dueAt),
    index("followups_owner_status_idx").on(table.ownerUserId, table.status),
    index("followups_household_scope_idx").on(table.householdId, table.scope),
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
    // Persisted source-grounding contract for the draft (PRD #75, issue #76,
    // ADR-0040). Snapshotted at generation time so the draft stays explainable
    // after the underlying memories, notes, follow-ups, or brief items change.
    sourceRefs: jsonb("source_refs").$type<DraftSourceRef[]>().notNull().default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (table) => [
    index("message_drafts_person_id_idx").on(table.personId),
    index("message_drafts_owner_user_id_idx").on(table.ownerUserId),
  ],
);
