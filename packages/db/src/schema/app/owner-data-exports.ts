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
import { ownerDataExportJobStatus } from "./enums";

/**
 * The durable control row for an explicitly requested owner export. This is
 * operational job state, not an exported product record. The archive itself
 * lives in the short-lived artifact store below and is deleted after its
 * expiry window.
 */
export const ownerDataExportJobs = pgTable(
  "owner_data_export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: ownerDataExportJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    artifactExpiresAt: timestamp("artifact_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("owner_data_export_jobs_owner_idempotency_key_idx").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    index("owner_data_export_jobs_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("owner_data_export_jobs_status_run_after_idx").on(table.status, table.runAfter),
    index("owner_data_export_jobs_expiry_idx").on(table.status, table.artifactExpiresAt),
  ],
);

// Postgres bytea. postgres-js returns a Buffer; the adapter normalizes it to a
// Uint8Array so the artifact store has the same shape in every runtime.
const bytea = customType<{ data: Uint8Array; driverData: Buffer | string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    if (typeof value === "string") {
      return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ""), "hex"));
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * Short-lived export bytes. Keeping this table separate from product records
 * makes the retention boundary explicit: a completed job is not an account
 * backup, and expiry removes the bytes and marks the control row expired.
 */
export const ownerDataExportArtifacts = pgTable(
  "owner_data_export_artifacts",
  {
    jobId: uuid("job_id")
      .primaryKey()
      .references(() => ownerDataExportJobs.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bytes: bytea("bytes").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("owner_data_export_artifacts_owner_expiry_idx").on(table.ownerUserId, table.expiresAt),
  ],
);
