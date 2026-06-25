import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  confidence,
  extractionJobStatus,
  privacyScope,
  sensitivity,
  sourceRecordPersonRole,
  sourceRecordRetentionPolicy,
  sourceRecordStatus,
  sourceType,
  unresolvedMentionStatus,
} from "./enums";
import { people } from "./people";

export const sourceRecords = pgTable(
  "source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceType: sourceType("source_type").notNull().default("manual"),
    content: text("content").notNull(),
    rawContent: text("raw_content"),
    retentionPolicy: sourceRecordRetentionPolicy("retention_policy").notNull().default("retain"),
    status: sourceRecordStatus("status").notNull().default("active"),
    confidence: confidence("confidence").notNull().default("medium"),
    sensitivity: sensitivity("sensitivity").notNull().default("normal"),
    scope: privacyScope("scope").notNull().default("private"),
    importance: integer("importance").notNull().default(3),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => [
    index("source_records_owner_user_id_idx").on(table.ownerUserId),
    index("source_records_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const sourceRecordPeople = pgTable(
  "source_record_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: sourceRecordPersonRole("role").notNull().default("mentioned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_record_people_record_person_idx").on(table.sourceRecordId, table.personId),
    index("source_record_people_person_id_idx").on(table.personId),
  ],
);

export const unresolvedPersonMentions = pgTable(
  "unresolved_person_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    mentionText: text("mention_text").notNull(),
    candidatePersonIds: jsonb("candidate_person_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: unresolvedMentionStatus("status").notNull().default("unresolved"),
    resolvedPersonId: uuid("resolved_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("unresolved_person_mentions_source_record_id_idx").on(table.sourceRecordId),
    index("unresolved_person_mentions_status_idx").on(table.status),
  ],
);

export const extractionJobs = pgTable(
  "extraction_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    status: extractionJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("extraction_jobs_idempotency_key_idx").on(table.idempotencyKey),
    index("extraction_jobs_source_record_id_idx").on(table.sourceRecordId),
    index("extraction_jobs_status_run_after_idx").on(table.status, table.runAfter),
  ],
);
