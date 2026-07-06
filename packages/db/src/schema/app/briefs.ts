import type { BriefSourceRef } from "@tendnote/domain";
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
  briefCadence,
  briefGenerationReason,
  briefItemKind,
  briefItemStatus,
  briefItemTrustLevel,
  privacyScope,
  sensitivity,
} from "./enums";
import { householdWorkspaces } from "./households";
import { people } from "./people";

/**
 * Persisted brief artifact shared by daily briefs and the weekly relationship
 * review (PRD #65, ADR-0008/0044). One model, one lifecycle: daily and weekly
 * differ only by cadence, window, cap, and ranking depth. The current brief for
 * an (owner, local date, cadence) is the row with `superseded_at` null; explicit
 * regeneration supersedes the prior row instead of deleting it, so prior briefs
 * stay queryable for feedback suppression and audit.
 */
export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cadence: briefCadence("cadence").notNull(),
    // Local calendar date the brief covers, formatted YYYY-MM-DD, so briefs align
    // with the user's day rather than UTC server time.
    localDate: text("local_date").notNull(),
    generationReason: briefGenerationReason("generation_reason").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    // Optional decorative summary line; null when absent or summary generation
    // failed open (PRD #65). Never a source of truth for item selection or rank.
    summary: text("summary"),
    summaryProvenance: jsonb("summary_provenance").$type<Record<string, unknown>>(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Exactly one current brief per owner/local date/cadence enforces idempotent
    // generation; superseded rows are excluded so history can accumulate.
    uniqueIndex("briefs_owner_date_cadence_current_idx")
      .on(table.ownerUserId, table.localDate, table.cadence)
      .where(sql`${table.supersededAt} is null`),
    index("briefs_owner_cadence_idx").on(table.ownerUserId, table.cadence),
  ],
);

/**
 * A persisted brief item: a snapshot of the relationship-agenda candidate shown
 * to the user. Render-time code reads these fields and never recomputes title,
 * reason, or rank from the live agenda query (PRD #65). Item lifecycle statuses
 * are local to the brief surface and do not mutate the underlying record.
 */
export const briefItems = pgTable(
  "brief_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: briefItemKind("kind").notNull(),
    // Person snapshot: id may be null for personless candidates; display name is
    // snapshotted so render code does not re-resolve people.
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    personDisplayName: text("person_display_name"),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sourceRefs: jsonb("source_refs").$type<BriefSourceRef[]>().notNull().default(sql`'[]'::jsonb`),
    trustLevel: briefItemTrustLevel("trust_level").notNull(),
    sensitivity: sensitivity("sensitivity").notNull().default("normal"),
    // Disclosure scope snapshotted from the backing record so scheduled-workflow
    // delivery can aggregate a brief's household-safety without re-reading sources
    // (ADR-0142). Fail-closed default `private`; `household_id` is set only for a
    // `household`-scoped item.
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    rank: integer("rank").notNull(),
    status: briefItemStatus("status").notNull().default("active"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("brief_items_brief_id_idx").on(table.briefId),
    index("brief_items_owner_status_idx").on(table.ownerUserId, table.status),
    index("brief_items_household_id_idx").on(table.householdId),
  ],
);
