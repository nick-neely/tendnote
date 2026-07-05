import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

/**
 * Owner-scoped Discord identity resolution (Phase 3 hardening, ADR-0122).
 *
 * Maps a Discord user id to the Tendnote owner that Discord interactions capture
 * for. This is the production, fail-closed replacement for the `DISCORD_OWNER_USER_MAP`
 * env var: an interaction from an unmapped Discord user resolves to no owner and is
 * rejected before any Source Record, Memory, Follow-Up, draft, or delivery setting
 * is written.
 *
 * A Discord user id is globally unique across Discord, so it is unique here too —
 * one Discord user maps to at most one Tendnote owner. Owner ids are never accepted
 * from Discord request bodies or slash command options; they come only from this
 * persisted state.
 *
 * NON-SECRET STATE ONLY. `display_identity` is an optional operator-facing label
 * (e.g. a Discord handle); this table stores no bot tokens, signatures, or raw
 * Discord payloads.
 */
export const discordIdentities = pgTable(
  "discord_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    // Optional non-secret display label (e.g. the Discord handle), null until known.
    displayIdentity: text("display_identity"),
    ...timestamps,
  },
  (table) => [
    index("discord_identities_owner_user_id_idx").on(table.ownerUserId),
    // One owner per Discord user id: resolution is a single-row lookup by this key.
    uniqueIndex("discord_identities_discord_user_id_idx").on(table.discordUserId),
  ],
);
