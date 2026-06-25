import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const relationshipType = pgEnum("relationship_type", [
  "friend",
  "family",
  "partner",
  "colleague",
  "professional",
  "networking",
  "neighbor",
  "other",
]);

export const contactMethodType = pgEnum("contact_method_type", [
  "email",
  "phone",
  "social",
  "other",
]);

export const sourceType = pgEnum("source_type", [
  "manual",
  "agent",
  "contact_import",
  "calendar",
  "gmail",
  "seed",
]);

export const memoryType = pgEnum("memory_type", [
  "preference",
  "life_event",
  "gift_idea",
  "boundary",
  "context",
  "other",
]);

export const sensitivity = pgEnum("sensitivity", ["normal", "sensitive", "restricted"]);

export const confidence = pgEnum("confidence", ["low", "medium", "high"]);

export const privacyScope = pgEnum("privacy_scope", ["private", "shared", "household"]);

export const sourceRecordStatus = pgEnum("source_record_status", [
  "pending_resolution",
  "active",
  "dismissed",
  "archived",
]);

export const sourceRecordRetentionPolicy = pgEnum("source_record_retention_policy", [
  "retain",
  "summarize_then_delete",
  "delete_after_processing",
]);

export const sourceRecordPersonRole = pgEnum("source_record_person_role", ["primary", "mentioned"]);

export const unresolvedMentionStatus = pgEnum("unresolved_mention_status", [
  "unresolved",
  "resolved",
  "dismissed",
]);

export const memoryStatus = pgEnum("memory_status", [
  "suggested",
  "approved",
  "dismissed",
  "archived",
]);

export const interactionType = pgEnum("interaction_type", [
  "call",
  "text",
  "email",
  "meeting",
  "hangout",
  "note",
]);

export const followupStatus = pgEnum("followup_status", [
  "suggested",
  "open",
  "snoozed",
  "completed",
  "dismissed",
  "archived",
]);

export const extractionJobStatus = pgEnum("extraction_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const messageDraftChannel = pgEnum("message_draft_channel", [
  "text",
  "email",
  "slack",
  "other",
]);

export const messageDraftPurpose = pgEnum("message_draft_purpose", [
  "birthday",
  "thank_you",
  "check_in",
  "networking",
  "other",
]);

export const messageDraftStatus = pgEnum("message_draft_status", [
  "draft",
  "approved",
  "dismissed",
  "sent_manually",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

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
    source: sourceType("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    index("people_owner_user_id_idx").on(table.ownerUserId),
    index("people_owner_display_name_idx").on(table.ownerUserId, table.displayName),
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
    isPrimary: boolean("is_primary").notNull().default(false),
    source: sourceType("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [index("contact_methods_person_id_idx").on(table.personId)],
);

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
    lastPromptedAt: timestamp("last_prompted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("followups_person_id_idx").on(table.personId),
    index("followups_owner_due_idx").on(table.ownerUserId, table.dueAt),
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

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_owner_user_id_idx").on(table.ownerUserId)],
);

export const peopleRelations = relations(people, ({ many, one }) => ({
  owner: one(user, {
    fields: [people.ownerUserId],
    references: [user.id],
  }),
  contactMethods: many(contactMethods),
  memories: many(memories),
  interactions: many(interactions),
  followups: many(followups),
  messageDrafts: many(messageDrafts),
  sourceRecordLinks: many(sourceRecordPeople),
  unresolvedMentions: many(unresolvedPersonMentions),
}));

export const contactMethodsRelations = relations(contactMethods, ({ one }) => ({
  person: one(people, {
    fields: [contactMethods.personId],
    references: [people.id],
  }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  person: one(people, {
    fields: [memories.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [memories.ownerUserId],
    references: [user.id],
  }),
  sourceRecord: one(sourceRecords, {
    fields: [memories.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export const sourceRecordsRelations = relations(sourceRecords, ({ many, one }) => ({
  owner: one(user, {
    fields: [sourceRecords.ownerUserId],
    references: [user.id],
  }),
  people: many(sourceRecordPeople),
  unresolvedMentions: many(unresolvedPersonMentions),
  memories: many(memories),
  extractionJobs: many(extractionJobs),
}));

export const sourceRecordPeopleRelations = relations(sourceRecordPeople, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [sourceRecordPeople.sourceRecordId],
    references: [sourceRecords.id],
  }),
  person: one(people, {
    fields: [sourceRecordPeople.personId],
    references: [people.id],
  }),
}));

export const unresolvedPersonMentionsRelations = relations(unresolvedPersonMentions, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [unresolvedPersonMentions.sourceRecordId],
    references: [sourceRecords.id],
  }),
  resolvedPerson: one(people, {
    fields: [unresolvedPersonMentions.resolvedPersonId],
    references: [people.id],
  }),
}));

export const extractionJobsRelations = relations(extractionJobs, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [extractionJobs.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export const followupsRelations = relations(followups, ({ one }) => ({
  person: one(people, {
    fields: [followups.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [followups.ownerUserId],
    references: [user.id],
  }),
}));

export const messageDraftsRelations = relations(messageDrafts, ({ one }) => ({
  person: one(people, {
    fields: [messageDrafts.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [messageDrafts.ownerUserId],
    references: [user.id],
  }),
}));
