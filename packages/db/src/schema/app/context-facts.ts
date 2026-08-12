import type { ContextFactProvenance } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import {
  check,
  index,
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
  contextFactCategory,
  contextFactLifecycle,
  contextFactSubject,
  sensitivity,
} from "./enums";
import { householdWorkspaces } from "./households";

export const contextFacts = pgTable(
  "context_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectKind: contextFactSubject("subject_kind").notNull(),
    subjectUserId: text("subject_user_id").references(() => user.id, { onDelete: "cascade" }),
    subjectHouseholdId: uuid("subject_household_id").references(() => householdWorkspaces.id, {
      onDelete: "cascade",
    }),
    category: contextFactCategory("category").notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content").notNull(),
    lifecycle: contextFactLifecycle("lifecycle").notNull().default("suggested"),
    sensitivity: sensitivity("sensitivity").notNull().default("normal"),
    provenanceJson: jsonb("provenance_json").$type<ContextFactProvenance>().notNull(),
    suggestionEvidence: text("suggestion_evidence"),
    creatorUserId: text("creator_user_id").references(() => user.id, { onDelete: "set null" }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("context_facts_subject_user_lifecycle_idx").on(
      table.subjectUserId,
      table.lifecycle,
      table.updatedAt,
    ),
    index("context_facts_subject_household_lifecycle_idx").on(
      table.subjectHouseholdId,
      table.lifecycle,
      table.updatedAt,
    ),
    uniqueIndex("context_facts_active_self_identity_idx")
      .on(table.subjectUserId, table.category, table.normalizedContent)
      .where(sql`${table.subjectKind} = 'self' AND ${table.lifecycle} = 'active'`),
    uniqueIndex("context_facts_active_household_identity_idx")
      .on(table.subjectHouseholdId, table.category, table.normalizedContent)
      .where(sql`${table.subjectKind} = 'household' AND ${table.lifecycle} = 'active'`),
    uniqueIndex("context_facts_suggested_self_identity_idx")
      .on(table.subjectUserId, table.category, table.normalizedContent, table.sensitivity)
      .where(sql`${table.subjectKind} = 'self' AND ${table.lifecycle} = 'suggested'`),
    uniqueIndex("context_facts_suggested_household_identity_idx")
      .on(table.subjectHouseholdId, table.category, table.normalizedContent, table.sensitivity)
      .where(sql`${table.subjectKind} = 'household' AND ${table.lifecycle} = 'suggested'`),
    uniqueIndex("context_facts_active_self_single_value_idx")
      .on(table.subjectUserId, table.category)
      .where(
        sql`${table.subjectKind} = 'self' AND ${table.lifecycle} = 'active' AND ${table.category} IN ('background', 'work', 'location')`,
      ),
    uniqueIndex("context_facts_active_household_single_value_idx")
      .on(table.subjectHouseholdId, table.category)
      .where(
        sql`${table.subjectKind} = 'household' AND ${table.lifecycle} = 'active' AND ${table.category} IN ('background', 'work', 'location')`,
      ),
    check(
      "context_facts_exactly_one_subject_check",
      sql`(
        (${table.subjectKind} = 'self' AND ${table.subjectUserId} IS NOT NULL AND ${table.subjectHouseholdId} IS NULL)
        OR
        (${table.subjectKind} = 'household' AND ${table.subjectUserId} IS NULL AND ${table.subjectHouseholdId} IS NOT NULL)
      )`,
    ),
    check(
      "context_facts_composition_household_check",
      sql`${table.category} <> 'composition' OR ${table.subjectKind} = 'household'`,
    ),
    check(
      "context_facts_content_length_check",
      sql`char_length(btrim(${table.content})) between 1 and 500`,
    ),
  ],
);
