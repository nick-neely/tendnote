import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { discordTargetKind } from "./enums";

/**
 * Owner-scoped Discord install and proactive-delivery target state (Phase 3
 * hardening, ADR-0139).
 *
 * A row records that a Tendnote owner installed the shared Discord application
 * into one Discord guild and, optionally, where that owner's proactive
 * deliveries should land. This is the SaaS replacement for the single global
 * `DISCORD_*` env target: many owners can share one Discord application, and
 * multiple owners can even share one guild, without one owner's install or
 * delivery target becoming another owner's.
 *
 * The unique key is (owner, guild), never guild alone — a guild id is NOT
 * unique here. That is exactly what lets two linked Tendnote users coexist in
 * the same guild with independent targets and enabled state.
 *
 * `target_kind` + `target_channel_id` are set together when an owner configures
 * where deliveries go; both are null until then, and a null target derives to no
 * deliverable destination. `enabled` gates delivery derivation without deleting
 * the install (or the separate `discord_identities` link), so an owner can
 * pause and resume proactive deliveries.
 *
 * NON-SECRET STATE ONLY. `scopes` (granted OAuth scopes) and `permissions` (the
 * bot permission bitfield string) are non-secret install metadata for operator
 * visibility. This table stores no bot token, no Discord request signature, and
 * no raw Discord interaction payload.
 */
export const discordInstalls = pgTable(
  "discord_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Discord guild (server) the application was installed into.
    guildId: text("guild_id").notNull(),
    // Discord user that installed / owns the link on the Discord side.
    discordUserId: text("discord_user_id").notNull(),
    // Where proactive deliveries land; null until the owner configures a target.
    targetKind: discordTargetKind("target_kind"),
    targetChannelId: text("target_channel_id"),
    enabled: boolean("enabled").notNull().default(true),
    // Non-secret granted OAuth scopes (e.g. ["bot", "applications.commands"]).
    scopes: jsonb("scopes").$type<string[]>(),
    // Non-secret Discord permission bitfield string granted at install.
    permissions: text("permissions"),
    ...timestamps,
  },
  (table) => [
    // One install per owner per guild: this is what keeps multiple owners in a
    // single guild independent rather than colliding on the guild id.
    uniqueIndex("discord_installs_owner_guild_idx").on(table.ownerUserId, table.guildId),
    index("discord_installs_owner_user_id_idx").on(table.ownerUserId),
    index("discord_installs_guild_id_idx").on(table.guildId),
  ],
);
