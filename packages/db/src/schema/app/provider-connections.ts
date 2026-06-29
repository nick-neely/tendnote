import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { providerConnectionStatus } from "./enums";

/**
 * Owner-scoped Provider Connection state (Phase 2B foundation, ADR-0069).
 *
 * Represents product integration authorization for one provider capability
 * (e.g. Google Calendar). Modelled with generic `provider_key`/`capability_key`
 * columns rather than a Google-specific table so future non-Google providers and
 * future memory-system products reuse the same shape without a rewrite.
 *
 * NON-SECRET STATE ONLY. This table intentionally has no access-token, refresh-
 * token, encrypted-token-blob, sync-cursor, provider-watermark, or raw-provider-
 * payload (Calendar/Gmail/Contacts data) columns. Token custody begins in the
 * first real OAuth/provider slice (Phase 2C+) so refresh, revocation, retention,
 * and encryption are designed together.
 */
export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Generic provider/capability keys (e.g. "google" / "calendar"). Kept as text
    // so adding a provider is a catalog change, not a schema migration.
    providerKey: text("provider_key").notNull(),
    capabilityKey: text("capability_key").notNull(),
    status: providerConnectionStatus("status").notNull().default("ready"),
    // Optional non-secret display identity (e.g. the connected account email),
    // null until a real connection exists.
    displayIdentity: text("display_identity"),
    // Optional non-secret authorized-scope metadata; lets later OAuth slices
    // explain granted scopes without changing the read model.
    authorizedScopes: jsonb("authorized_scopes").$type<string[]>(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    // Audit-facing detail strings; never secrets or raw provider payloads.
    lastErrorMessage: text("last_error_message"),
    revocationReason: text("revocation_reason"),
    ...timestamps,
  },
  (table) => [
    index("provider_connections_owner_user_id_idx").on(table.ownerUserId),
    // One connection row per owner + provider capability.
    uniqueIndex("provider_connections_owner_capability_idx").on(
      table.ownerUserId,
      table.providerKey,
      table.capabilityKey,
    ),
  ],
);
