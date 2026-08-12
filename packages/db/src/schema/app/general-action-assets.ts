import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { assetMemories } from "./asset-memories";
import { assets } from "./assets";
import { generalActions } from "./general-actions";

/**
 * General Action ↔ Asset links (#199): the durable bridge a Phase 5 asset hint
 * grows into (ADR 0156). Created when a hint is promoted — pointing at the
 * suggested asset row while review is pending (acceptance flips the same row in
 * place, so the link never moves), re-pointed when duplicate review links to an
 * existing Asset instead. A link is context, not ownership: each side is
 * scope-filtered independently on display, mirroring `general_action_people`.
 * `hint_label` preserves which hint the link came from, keeping promotion
 * idempotent per hint. Rows cascade with either side.
 *
 * `asset_memory_id` records the other direction (#203): the action was *proposed
 * from* a reviewed Asset Memory (a warranty date, a replacement interval). It is
 * what keeps proposal generation idempotent — one memory proposes one action —
 * and it lets the Asset Profile say which detail a suggested reminder came from.
 */
export const generalActionAssets = pgTable(
  "general_action_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Attribution only; both parents decide authority independently.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    hintLabel: text("hint_label"),
    // The reviewed Asset Memory that proposed this action (#203), or null for a
    // hint promotion or a plain association. Cascades with the memory: a deleted
    // memory takes its provenance with it, and the action itself stands.
    assetMemoryId: uuid("asset_memory_id").references(() => assetMemories.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("general_action_assets_action_asset_idx").on(table.generalActionId, table.assetId),
    index("general_action_assets_asset_idx").on(table.assetId),
    index("general_action_assets_creator_idx").on(table.createdByUserId),
    // The idempotency read: "has this memory already proposed an action?" (#203).
    index("general_action_assets_asset_memory_idx").on(table.assetMemoryId),
  ],
);
