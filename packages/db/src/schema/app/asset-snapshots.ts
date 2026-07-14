import type { AssetSnapshotSupportingReferences } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { assets } from "./assets";
import { timestamps } from "./common";

/**
 * Asset Snapshots (#196, #204): a rebuildable generated cache that lets an Asset
 * Profile and Eve load useful context fast. **Never a source of truth.** Three
 * columns keep that promise structural rather than aspirational:
 *
 * - `supporting_references` — the ids of the exact rows the prose was built from, so
 *   any claim can be traced back to a real record;
 * - `input_fingerprint` — a hash of those inputs, so staleness is *recomputed* on
 *   read rather than signalled by an invalidation event someone can forget to fire;
 * - `failure_reason` — set when generation failed, which also makes the row
 *   permanently un-fresh so the next read retries it.
 *
 * There is no `scope` column and no `visibility_record_kind` entry: a snapshot is
 * owner-private cache, built per (owner, asset) from what *that owner* may see. A
 * household member never reads another member's snapshot row — they get their own,
 * built from their own visibility-filtered pack, so the cache can never widen access.
 */
export const assetSnapshots = pgTable(
  "asset_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    supportingReferences: jsonb("supporting_references")
      .$type<AssetSnapshotSupportingReferences>()
      .notNull()
      .default(
        sql`'{"assetIds":[],"assetMemoryIds":[],"assetEvidenceIds":[],"relatedAssetLinkIds":[],"assetPersonLinkIds":[],"generalActionIds":[]}'::jsonb`,
      ),
    generatorVersion: text("generator_version").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    // One current row per owner/asset — a cache, not a history.
    uniqueIndex("asset_snapshots_owner_asset_idx").on(table.ownerUserId, table.assetId),
    index("asset_snapshots_asset_idx").on(table.assetId),
  ],
);
