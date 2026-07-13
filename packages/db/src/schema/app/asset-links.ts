import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { assets } from "./assets";
import { timestamps } from "./common";
import { assetLinkRelation, assetLinkStatus, assetPersonRelation } from "./enums";
import { people } from "./people";
import { sourceRecords } from "./source-records";

/**
 * Related Asset Links (#202): lightweight subject → relation → object context
 * between two Assets — a filter fits a refrigerator, a charger goes with a
 * laptop — with the small fixed relation set (fits, uses, part of, replaces,
 * covers, stored with). Deliberately not a graph: no hierarchy, inheritance,
 * rollups, or cascade rules (#196 deferred scope). A link is context, not
 * ownership — it carries no scope of its own and surfaces on a profile only
 * where the caller can see *both* sides, mirroring `general_action_assets`.
 * Inferred links are born `suggested` (review-gated, owner-only) and flip to
 * `active` in place on accept, like Asset Memories. The unique triple is
 * owner-scoped: two household members may each hold their own row for the same
 * relationship, so no caller's write ever touches — resolves, revives, or
 * removes — a co-member's link or its review state; reads dedupe per caller.
 * Rows cascade with either asset.
 */
export const assetLinks = pgTable(
  "asset_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The link's creator; either linked asset may belong to a household co-member.
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fromAssetId: uuid("from_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    toAssetId: uuid("to_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    relation: assetLinkRelation("relation").notNull(),
    // Fail closed: an unstated status is a review-gated suggestion, never truth.
    status: assetLinkStatus("status").notNull().default("suggested"),
    // Grounding for inferred links (ADR 0151); null for explicit user creates.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    // One row per owner per (from, to, relation) triple keeps creation
    // idempotent without letting one owner's write reach another's row.
    uniqueIndex("asset_links_owner_from_to_relation_idx").on(
      table.ownerUserId,
      table.fromAssetId,
      table.toAssetId,
      table.relation,
    ),
    index("asset_links_from_asset_idx").on(table.fromAssetId),
    index("asset_links_to_asset_idx").on(table.toAssetId),
    index("asset_links_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

/**
 * Asset Person Links (#202): lightweight person → contextual relation → asset
 * context — who recommended, borrowed, uses, stores, services, or knows about
 * an Asset (#196). People are owner-private records, so a person link surfaces
 * only to its owner; it never makes a person an asset owner and never widens
 * the asset's visibility. Rows cascade with either side.
 */
export const assetPersonLinks = pgTable(
  "asset_person_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relation: assetPersonRelation("relation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Owner-scoped like asset_links: one row per owner per (asset, person,
    // relation) triple, so no write can ever reach a co-member's row.
    uniqueIndex("asset_person_links_owner_asset_person_relation_idx").on(
      table.ownerUserId,
      table.assetId,
      table.personId,
      table.relation,
    ),
    index("asset_person_links_asset_idx").on(table.assetId),
    index("asset_person_links_person_idx").on(table.personId),
  ],
);
