# Discord Linking Mirrors Owner-Scoped Connection

Tendnote users link Discord through Better Auth's Discord provider (feature-specific
`linkSocial`, not sign-in). Better Auth owns the authenticated OAuth flow and token
custody; Tendnote owns product state. A completed link is mirrored into two
owner-scoped, non-secret records: the `discord_identities` mapping (ADR-0122 / #166)
that inbound Discord interactions resolve against, and a Discord Provider Connection
(ADR-0069 vocabulary: provider `discord`, capability `channel`) that the account
settings surface reads. Linking is identity and consent only — it does not replace
Discord interaction signature verification; signed webhooks still enter through the
product-owned Discord channel.

The stable identity is the Discord user id (the OAuth `accountId` snowflake), never
an email: the provider is pinned to the `identify` scope with `disableDefaultScope`,
so Discord's default `email` scope is not requested and phone-only / no-email Discord
accounts link cleanly. For a human-verifiable display, reconcile best-effort resolves
the Discord username/global name via `/users/@me` at link time and stores it as the
connection's display identity, falling back to a clearly labeled id when the username
cannot be fetched.

Reconciliation is owner-scoped and fail-safe. A Discord user id already mapped to a
different Tendnote owner is never silently reassigned (ADR-0122 / #166): the
account-page reconcile records an actionable conflict error instead — including when
the claim races the pre-check and the persisted mapping's reassign guard throws.
Disconnecting is scoped to Discord alone (unrelated Google capabilities are
untouched): it authoritatively unlinks the Better Auth Discord account by
provider+account id (so the reconcile cannot re-link/re-connect), removes the owner's
persisted identity mapping so inbound interactions fail closed, and marks the Provider
Connection revoked.
