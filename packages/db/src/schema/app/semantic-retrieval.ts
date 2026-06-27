import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { embeddingJobStatus, semanticRecordKind, semanticTrustLevel, sensitivity } from "./enums";
import { people } from "./people";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
});

export const relationshipContextEmbeddings = pgTable(
  "relationship_context_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "cascade" }),
    recordKind: semanticRecordKind("record_kind").notNull(),
    recordId: uuid("record_id").notNull(),
    embedding: vector("embedding").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingVersion: text("embedding_version").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    embeddedText: text("embedded_text").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    trustLevel: semanticTrustLevel("trust_level").notNull(),
    sensitivity: sensitivity("sensitivity").notNull().default("normal"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("relationship_context_embeddings_current_idx").on(
      table.ownerUserId,
      table.recordKind,
      table.recordId,
      table.embeddingModel,
      table.embeddingVersion,
    ),
    index("relationship_context_embeddings_owner_record_idx").on(
      table.ownerUserId,
      table.recordKind,
      table.recordId,
    ),
    index("relationship_context_embeddings_owner_person_idx").on(table.ownerUserId, table.personId),
    index("relationship_context_embeddings_compat_idx").on(
      table.ownerUserId,
      table.embeddingModel,
      table.embeddingVersion,
      table.embeddingDimensions,
    ),
  ],
);

export const relationshipContextEmbeddingJobs = pgTable(
  "relationship_context_embedding_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recordKind: semanticRecordKind("record_kind").notNull(),
    recordId: uuid("record_id").notNull(),
    status: embeddingJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("relationship_context_embedding_jobs_idempotency_key_idx").on(table.idempotencyKey),
    index("relationship_context_embedding_jobs_owner_record_idx").on(
      table.ownerUserId,
      table.recordKind,
      table.recordId,
    ),
    index("relationship_context_embedding_jobs_status_run_after_idx").on(
      table.status,
      table.runAfter,
    ),
  ],
);
