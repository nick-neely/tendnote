import type { AssetEvidenceMoney } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import {
  customType,
  date,
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
import { assetReviewGroups } from "./asset-review-groups";
import { assets } from "./assets";
import { timestamps } from "./common";
import { assetEvidenceKind, assetOwnership, privacyScope } from "./enums";
import { householdWorkspaces } from "./households";
import { sourceRecords } from "./source-records";

/**
 * Asset Evidence (#196, #200): grounding for an Asset and its memories — a
 * receipt, photo, manual, warranty, link, or retained text, with lightweight
 * money/renewal metadata for recall. This row is the metadata; uploaded bytes
 * live in `asset_evidence_files`, keyed by this row's id, so lists and scope
 * checks never touch file contents. Attachment: always an Asset (`asset_id`),
 * plus the Asset Review Group it arrived through, kept as provenance after
 * review resolves. Visibility is per-record under the child-scope ceiling — a household
 * Asset can hold a private receipt its members never see. Deliberately not a
 * document library, folder system, or finance ledger.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const assetEvidence = pgTable(
  "asset_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: assetEvidenceKind("kind").notNull(),
    label: text("label").notNull(),
    // Upload metadata, present together when (and only when) bytes are stored.
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    url: text("url"),
    // Retained text — captured verbatim now; the seam future OCR fills later (#196).
    capturedText: text("captured_text"),
    // Lightweight amount/currency for receipts and renewals — recall metadata,
    // never budgets or reporting (#196).
    moneyJson: jsonb("money_json").$type<AssetEvidenceMoney | null>(),
    // Day-precise purchase/renewal anchors — facts, not timestamps.
    purchasedOn: date("purchased_on"),
    renewsOn: date("renews_on"),
    scope: privacyScope("scope").notNull().default("private"),
    // Ownership form (#386). Evidence is immutable either way; the form decides
    // who may remove it, and whether it follows workspace retention or leaves
    // with its member (ADR 0214).
    ownership: assetOwnership("ownership").notNull().default("member_owned"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    // The Asset Review Group this evidence arrived through. Kept after review
    // resolves — provenance, exactly as accepted Asset Memories keep theirs.
    reviewGroupId: uuid("review_group_id").references(() => assetReviewGroups.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Exact-recall vector over what the evidence *says it is*: its label, its file
    // name, any retained captured text, and a receipt amount (#204). The
    // purchase/renewal dates are deliberately absent — casting a `date` to text is
    // locale-dependent and therefore not immutable, so a generated column cannot hold
    // it. Dates are matched in the structured tier instead, by comparing the column
    // directly, which is both exact and index-friendly.
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("label", '') || ' ' || coalesce("file_name", '') || ' ' || coalesce("captured_text", '') || ' ' || coalesce("money_json"->>'amount', ''))`,
      ),
    ...timestamps,
  },
  (table) => [
    index("asset_evidence_asset_idx").on(table.assetId, table.createdAt),
    index("asset_evidence_owner_idx").on(table.ownerUserId),
    index("asset_evidence_review_group_idx").on(table.reviewGroupId),
    index("asset_evidence_search_vector_idx").using("gin", table.searchVector),
  ],
);

// Postgres bytea. postgres-js hands back a Buffer; the Neon HTTP driver a
// `\x…` hex string — normalize both to Uint8Array so callers never care.
const bytea = customType<{ data: Uint8Array; driverData: Buffer | string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    if (typeof value === "string") {
      return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ""), "hex"));
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * The stored bytes behind one uploaded piece of Asset Evidence (#200). One row
 * per evidence row, riding its lifecycle via the cascade — deleting evidence (or
 * its asset, or its owner) deletes the bytes, so no orphaned file bucket can
 * form. Postgres-owned like every other durable Tendnote store; if a dedicated
 * blob backend arrives later, this table swaps out behind the evidence store
 * seam without touching the evidence metadata model.
 */
export const assetEvidenceFiles = pgTable(
  "asset_evidence_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => assetEvidence.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("asset_evidence_files_evidence_idx").on(table.evidenceId)],
);
