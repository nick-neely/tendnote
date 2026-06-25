import type { CompactFollowupReference, SnapshotSupportingReferences } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { people } from "./people";

const EMPTY_REFERENCES =
  '{"personIds":[],"memoryIds":[],"sourceRecordIds":[],"suggestedMemoryIds":[],"followupIds":[]}';

/**
 * Rebuildable per-person context cache (ADR 0009). One current row per
 * owner/person — enforced by the unique index — storing generated summary prose,
 * record-level supporting references, and operational cache metadata. Not a
 * source of truth: canonical facts stay in people, memories, source records,
 * suggested memories, and follow-ups.
 */
export const personContextSnapshots = pgTable(
  "person_context_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    supportingReferences: jsonb("supporting_references")
      .$type<SnapshotSupportingReferences>()
      .notNull()
      .default(sql.raw(`'${EMPTY_REFERENCES}'::jsonb`)),
    followups: jsonb("followups")
      .$type<CompactFollowupReference[]>()
      .notNull()
      .default(sql.raw(`'[]'::jsonb`)),
    generatorVersion: text("generator_version").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("person_context_snapshots_owner_person_idx").on(table.ownerUserId, table.personId),
    index("person_context_snapshots_person_id_idx").on(table.personId),
  ],
);
