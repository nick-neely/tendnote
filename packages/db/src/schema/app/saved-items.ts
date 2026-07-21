import { sql } from "drizzle-orm";
import {
  customType,
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
  privacyScope,
  savedItemDestinationKind,
  savedItemEventKind,
  savedItemKind,
  savedItemStatus,
} from "./enums";
import { householdWorkspaces } from "./households";
import { sourceRecords } from "./source-records";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const savedItems = pgTable(
  "saved_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: savedItemKind("kind").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    url: text("url"),
    status: savedItemStatus("status").notNull().default("active"),
    bringBackAt: timestamp("bring_back_at", { withTimezone: true }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    scope: privacyScope("scope").notNull().default("private"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '') || ' ' || coalesce("url", ''))`,
      ),
    ...timestamps,
  },
  (table) => [
    index("saved_items_owner_status_idx").on(table.ownerUserId, table.status),
    index("saved_items_owner_bring_back_idx").on(table.ownerUserId, table.bringBackAt),
    index("saved_items_source_record_idx").on(table.sourceRecordId),
    index("saved_items_household_scope_idx").on(table.householdId, table.scope),
    index("saved_items_search_vector_idx").using("gin", table.searchVector),
  ],
);

export const savedItemEvents = pgTable(
  "saved_item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savedItemId: uuid("saved_item_id")
      .notNull()
      .references(() => savedItems.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: savedItemEventKind("kind").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    detailJson: jsonb("detail_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("saved_item_events_item_idx").on(table.savedItemId, table.createdAt),
    index("saved_item_events_owner_idx").on(table.ownerUserId),
  ],
);

export const savedItemOutcomes = pgTable(
  "saved_item_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savedItemId: uuid("saved_item_id")
      .notNull()
      .references(() => savedItems.id, { onDelete: "cascade" }),
    destinationKind: savedItemDestinationKind("destination_kind").notNull(),
    destinationRecordId: uuid("destination_record_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("saved_item_outcomes_idempotency_idx").on(table.idempotencyKey),
    uniqueIndex("saved_item_outcomes_destination_idx").on(
      table.savedItemId,
      table.destinationKind,
      table.destinationRecordId,
    ),
  ],
);
