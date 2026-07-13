import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
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
 */
export const generalActionAssets = pgTable(
  "general_action_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The action owner who created the link; the asset may belong to a co-member
    // after duplicate review links to an existing household Asset.
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    generalActionId: uuid("general_action_id")
      .notNull()
      .references(() => generalActions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    hintLabel: text("hint_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("general_action_assets_action_asset_idx").on(table.generalActionId, table.assetId),
    index("general_action_assets_asset_idx").on(table.assetId),
    index("general_action_assets_owner_idx").on(table.ownerUserId),
  ],
);
