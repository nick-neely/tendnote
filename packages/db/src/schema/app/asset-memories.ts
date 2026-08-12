import type { AssetMemoryValue } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { check, customType, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { assetReviewGroups } from "./asset-review-groups";
import { assets } from "./assets";
import { householdRecordOwnershipCheck, timestamps } from "./common";
import { assetMemoryStatus, assetOwnership, privacyScope } from "./enums";
import { householdWorkspaces } from "./households";
import { sourceRecords } from "./source-records";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Asset Memories (#196, #198): durable, reviewed personal context anchored to one
 * Asset — model numbers, filter sizes, purchase/warranty/renewal dates, receipt
 * amounts, maintenance notes. `label` names the fact; `value_json` carries the
 * typed exact value (text/date/amount union validated in the domain schema);
 * `notes` the freeform context. A memory is born `suggested` when inferred and
 * only becomes `active` through review or explicit creation — inference never
 * silently becomes truth. Visibility is per-record and never broader than the
 * Asset's own scope (the child-scope ceiling).
 */
export const assetMemories = pgTable(
  "asset_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    status: assetMemoryStatus("status").notNull().default("suggested"),
    label: text("label").notNull(),
    valueJson: jsonb("value_json").$type<AssetMemoryValue | null>(),
    notes: text("notes"),
    // Per-record visibility, at or below the Asset's scope. This slice supports
    // private/household; a selected-shared memory audience is a later, additive step.
    scope: privacyScope("scope").notNull().default("private"),
    // Ownership form (#386), independent of the parent Asset's: the household's
    // refrigerator can hold one member's private receipt note, and a
    // jointly-maintained filter size on it belongs to the workspace (ADR 0179).
    ownership: assetOwnership("ownership").notNull().default("member_owned"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    // Optimistic-concurrency fence for a jointly-maintained detail (#386).
    revision: integer("revision").notNull().default(0),
    // Evidence/source grounding: where this memory was inferred or captured from.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    // The Asset Review Group a suggested memory arrived in, for grouped review.
    reviewGroupId: uuid("review_group_id").references(() => assetReviewGroups.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Exact-recall vector over the fact itself: its label, its freeform notes, and the
    // scalar inside its typed value. Folding `value_json` in is what makes a serial
    // number, model name, filter size, receipt amount, or date findable by typing it
    // literally — the exact-recall tier of unified Asset Search (#204).
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("label", '') || ' ' || coalesce("notes", '') || ' ' || coalesce("value_json"->>'text', '') || ' ' || coalesce("value_json"->>'date', '') || ' ' || coalesce("value_json"->>'amount', ''))`,
      ),
    ...timestamps,
  },
  (table) => [
    index("asset_memories_asset_status_idx").on(table.assetId, table.status),
    index("asset_memories_owner_status_idx").on(table.ownerUserId, table.status),
    index("asset_memories_review_group_idx").on(table.reviewGroupId),
    index("asset_memories_search_vector_idx").using("gin", table.searchVector),
    check("asset_memories_ownership_check", householdRecordOwnershipCheck(table)),
  ],
);
