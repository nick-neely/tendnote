# Discord Installs Are Owner-and-Guild Scoped

Persisted Discord install/target state (#168) is a separate concern from Discord
identity resolution (`discord_identities`, ADR-0122) and from proactive workflow
delivery settings (`scheduled_workflow_delivery_settings`). Identity answers "which
Tendnote owner does this Discord user id capture for"; the new `discord_installs`
table answers "which owner installed the shared Discord app into which guild, and
where — if anywhere — that owner's proactive deliveries land". Keeping install/target
state in its own owner-scoped query module (`@tendnote/db/queries/discord-installs`,
following the established `types`/`queries`/`drizzle-store`/`in-memory-store`
module layout, with a barrel that eagerly constructs a drizzle-backed default
instance whose db handle resolves lazily via `getDb()`) avoids overloading the
identity mapping and lets the SaaS install model evolve independently.

The unique key is (owner, guild), never guild alone. A Discord guild id is not unique
in this table, which is exactly what lets multiple linked Tendnote users share one
guild without one owner's install, target, or enabled state becoming another's. Every
write entry point (record install, configure target, enable/disable, remove) is keyed
on the (owner, guild) pair and only ever touches the requesting owner's row, so
cross-owner writes and deliveries are structurally impossible — configuring or removing
a foreign owner's install is a no-op that resolves to `null`/`false`, not a hijack.
Recording an install is deliberately distinct from configuring a target: re-recording
refreshes the Discord user id and scope/permission metadata but preserves an
already-configured target and the enabled flag.

Proactive delivery targets remain owner-scoped and workflow-specific in
`scheduled_workflow_delivery_settings`; the install table does not replace them. Instead
`deriveDeliveryTarget` is a fail-closed read seam that yields a deliverable destination
only for an enabled install with a configured target, and `null` otherwise — so
disabling delivery (or leaving a target unconfigured) derives to no destination without
deleting the install or the separate identity link, and re-enabling restores the same
target. A guild-less derivation resolves an owner's single deliverable install but fails
closed to `null` when more than one is deliverable, forcing explicit guild
disambiguation rather than guessing a target.

The table stores non-secret install metadata only: guild id, installed-by owner, Discord
user id, target kind + channel id, enabled state, granted OAuth `scopes`, and the bot
`permissions` bitfield string. It stores no bot token, no Discord request signature, and
no raw Discord interaction payload; signature verification stays in the product-owned
Discord channel (ADR-0138) and token custody stays with Better Auth.
