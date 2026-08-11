import { sql } from "drizzle-orm";
import {
  check,
  customType,
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
  householdRecordOwnership,
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
    // Nullable because a household-native Saved Item is owned by the workspace,
    // not by a member (ADR 0214, #385). `saved_items_ownership_check` below is
    // what keeps the column and the ownership form from disagreeing.
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    ownership: householdRecordOwnership("ownership").notNull().default("member_owned"),
    kind: savedItemKind("kind").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    url: text("url"),
    status: savedItemStatus("status").notNull().default("active"),
    bringBackAt: timestamp("bring_back_at", { withTimezone: true }),
    bringBackTimeSemantics: text("bring_back_time_semantics")
      .$type<"date_only" | "instant">()
      .notNull()
      .default("date_only"),
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
    // The optimistic-concurrency counter every write increments. Household-native
    // writes compare it before saving so a stale member is reconciled instead of
    // silently overwriting the member who saved first (#385).
    version: integer("version").notNull().default(1),
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
    index("saved_items_household_ownership_idx").on(
      table.householdId,
      table.ownership,
      table.status,
    ),
    index("saved_items_search_vector_idx").using("gin", table.searchVector),
    // The two ownership forms written as one constraint so no adapter can invent
    // a third: a member-owned row always names its member, and a household-native
    // row names no member, sits in a household, is visible to all of it, and
    // still records who created it (ADR 0214).
    check(
      "saved_items_ownership_check",
      sql`(
        (${table.ownership} = 'member_owned' and ${table.ownerUserId} is not null)
        or (
          ${table.ownership} = 'household_native'
          and ${table.ownerUserId} is null
          and ${table.householdId} is not null
          and ${table.scope} = 'household'
          and ${table.createdByUserId} is not null
        )
      )`,
    ),
  ],
);

export const savedItemEvents = pgTable(
  "saved_item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savedItemId: uuid("saved_item_id")
      .notNull()
      .references(() => savedItems.id, { onDelete: "cascade" }),
    // Null on a household-native item's trail, matching its Saved Item. The
    // actor is still recorded: attribution survives, authority never came from
    // this column (ADR 0214).
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
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
