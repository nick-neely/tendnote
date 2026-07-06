import type { GeneralActionAssetHint, GeneralActionLink } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { generalActionEventKind, generalActionStatus, privacyScope } from "./enums";
import { generalActionAreas } from "./general-action-areas";
import { householdWorkspaces } from "./households";
import { people } from "./people";
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
    // At most one primary Area per Action in Phase 5 (ADR 0146, #179). Nullable —
    // an Action may be unfiled — and set-null on Area delete so the Action survives.
    areaId: uuid("area_id").references(() => generalActionAreas.id, {
      onDelete: "set null",
    }),
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    // Lightweight object/asset hints (subject labels) carried before Asset/Object
    // Memory exists, so a later phase can link or promote them (ADR 0156). Not
    // durable asset records — just labels, like `links` is not document management.
    assetHints: jsonb("asset_hints")
      .$type<GeneralActionAssetHint[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    index("general_actions_owner_area_idx").on(table.ownerUserId, table.areaId),
    index("general_actions_household_scope_idx").on(table.householdId, table.scope),
  ],
);

/**
 * Optional people links on a General Action: a person is attached as *context* (buy
 * a gift for them, book their appointment) without the Action becoming a
 * person-centered Follow-Up (ADR 0155). A lightweight join, not a reconnect
 * relationship — General Actions never appear in follow-up flows by virtue of a
 * link. Rows cascade with either side so a deleted Action or person leaves no
 * dangling link.
 */
export const generalActionPeople = pgTable(
  "general_action_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("general_action_people_action_person_idx").on(
      table.generalActionId,
      table.personId,
    ),
    index("general_action_people_person_idx").on(table.personId),
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
