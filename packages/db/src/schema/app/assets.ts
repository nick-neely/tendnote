import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  assetAuditEventKind,
  assetAuditSource,
  assetKind,
  assetOwnership,
  assetStatus,
  privacyScope,
} from "./enums";
import { householdWorkspaces } from "./households";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Assets: practical owner- or household-scoped things Tendnote tracks over time —
 * appliances, vehicles, subscriptions, services, household items (Phase 6 #196,
 * #197). An Asset is a lightweight anchor, deliberately minimal in this slice:
 * name + kind + visibility + active/archive lifecycle + provenance. Asset
 * Memories, Evidence, links, and snapshots attach to this record in later slices,
 * so the model here is the seam they build on — never a person, project,
 * document library, or generic object store.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The member this row is keyed by.
     *
     * On a `household_native` Asset this is the creating member and nothing
     * else: a storage key, kept because the column is `NOT NULL`, because every
     * owner-keyed write and audit row hangs off it, and because creator
     * provenance is worth keeping. It is never authority and never an access
     * path — the owner-keyed *read* refuses household-native rows so a departed
     * creator loses the household's refrigerator like anyone else (ADR 0214).
     */
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Small fixed kind set — behavior and prompts key off it; no custom taxonomy.
    kind: assetKind("kind").notNull(),
    // Archive is the normal inactive path; archived assets keep their history.
    // It is also the *only* removal path for a household-native Asset (ADR 0214).
    status: assetStatus("status").notNull().default("active"),
    // Visibility (ADR 0153). The Asset's scope is also the broadest allowed
    // visibility for future child records — children may narrow, never widen (#196).
    scope: privacyScope("scope").notNull().default("private"),
    // Ownership form (ADR 0214, #386). Stored rather than derived: a member-owned
    // Asset at `household` scope and a household-native one are the same row to
    // the audience rule and could not be told apart without this.
    ownership: assetOwnership("ownership").notNull().default("member_owned"),
    householdId: uuid("household_id").references(() => householdWorkspaces.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Optimistic-concurrency fence for the jointly-maintained case (#386). A
    // counter, not a timestamp: two members editing the household refrigerator
    // in the same second is precisely what this exists for.
    revision: integer("revision").notNull().default(0),
    // Creator provenance and actor provenance for lifecycle changes (ADR 0154).
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Exact-recall vector over the asset's name — the lexical tier of unified Asset
    // Search (#204). Generated and maintained by Postgres, like every other search
    // vector in the schema, so it can never drift from the row.
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', coalesce("name", ''))`),
    ...timestamps,
  },
  (table) => [
    index("assets_owner_status_idx").on(table.ownerUserId, table.status),
    index("assets_owner_kind_idx").on(table.ownerUserId, table.kind),
    index("assets_household_scope_idx").on(table.householdId, table.scope),
    // The household's own assets, and the ones a departing member's revert has to
    // find (#386) — both are (household, ownership) reads.
    index("assets_household_ownership_idx").on(table.householdId, table.ownership),
    index("assets_search_vector_idx").using("gin", table.searchVector),
  ],
);

/**
 * Internal Asset Audit: an append-only trail of asset writes — create, edit,
 * archive, restore — with actor, source, the scope the asset held at write time,
 * and free-form provenance detail (#197). Internal-first: exists so asset writes
 * and future trusted-agent modes can be debugged and held accountable, distinct
 * from any user-facing Asset History (#196).
 */
export const assetAuditEvents = pgTable(
  "asset_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: assetAuditEventKind("kind").notNull(),
    // Actor provenance: who performed this write (ADR 0154).
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    source: assetAuditSource("source").notNull(),
    // The asset's visibility scope when this event was recorded.
    scope: privacyScope("scope").notNull(),
    detailJson: jsonb("detail_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("asset_audit_events_asset_idx").on(table.assetId, table.createdAt),
    index("asset_audit_events_owner_idx").on(table.ownerUserId),
  ],
);
