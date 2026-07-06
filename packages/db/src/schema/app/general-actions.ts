import type { GeneralActionLink } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { generalActionEventKind, generalActionStatus, privacyScope } from "./enums";
import { householdWorkspaces } from "./households";
import { sourceRecords } from "./source-records";

/**
 * General Actions: non-person Personal OS actions such as "replace the
 * refrigerator water filter", kept as their own model separate from
 * person-centered Follow-Ups (ADR 0143). Phase 5 #178 covers private one-time
 * actions; the scope/household columns default to private so shared and household
 * scopes can be added additively later (#180, ADR 0153), mirroring how Follow-Ups
 * gained scope.
 */
export const generalActions = pgTable(
  "general_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    // Lightweight links (URL + optional label), not attachment/document
    // management (ADR 0164).
    links: jsonb("links").$type<GeneralActionLink[]>().notNull().default(sql`'[]'::jsonb`),
    status: generalActionStatus("status").notNull().default("open"),
    // A General Action may be unscheduled, so a due date is optional (ADR 0149).
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Resurface date set when the action is deferred (ADR 0149).
    deferUntil: timestamp("defer_until", { withTimezone: true }),
    // Source grounding where present; null for direct user-created actions.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    // Creator provenance and actor provenance for lifecycle changes (ADR 0154).
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("general_actions_owner_status_idx").on(table.ownerUserId, table.status),
    index("general_actions_owner_due_idx").on(table.ownerUserId, table.dueAt),
    index("general_actions_household_scope_idx").on(table.householdId, table.scope),
  ],
);

/**
 * Lifecycle history for a General Action: an append-only trail of what happened
 * and who did it, so Eve and the product can explain an action's story. History
 * without productivity analytics — no scoring, streaks, or predictions (ADR 0165).
 */
export const generalActionEvents = pgTable(
  "general_action_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: generalActionEventKind("kind").notNull(),
    // Actor provenance: who performed this change (ADR 0154).
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    detailJson: jsonb("detail_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("general_action_events_action_idx").on(table.generalActionId, table.createdAt),
    index("general_action_events_owner_idx").on(table.ownerUserId),
  ],
);
