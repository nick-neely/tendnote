import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { assets } from "./assets";
import { sourceRecords } from "./source-records";

/**
 * Asset Review Groups (#198): one review unit in the shared Review Queue,
 * anchoring everything inferred from a single source context — a Suggested Asset
 * (or an existing Asset gaining details), its Suggested Asset Memories, and the
 * duplicate-review prompt. `asset_id` is the anchor: the suggested asset row
 * while the proposal is pending, re-pointed to the existing Asset when duplicate
 * review links instead of creating. Later slices (#199, #200) attach evidence
 * and suggested actions to the same group additively.
 */
export const assetReviewGroups = pgTable(
  "asset_review_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    // The source record grounding the group's suggestions (ADR 0151). Kept when
    // the source is deleted so the group's members stay reviewable.
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("asset_review_groups_owner_idx").on(table.ownerUserId, table.createdAt),
    index("asset_review_groups_asset_idx").on(table.assetId),
  ],
);
