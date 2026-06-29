# Provider Connections Before Google OAuth

Phase 2B should add a modular provider-connection foundation before any live Google OAuth flow, token storage, Calendar read, Gmail draft creation, or Contacts import exists. The connection model should be provider-capability oriented rather than Google-specific, so Google Calendar, Gmail, Google Contacts, and future providers can share one owner-scoped status, consent, revocation, and audit shape without each integration inventing its own table later.

Better Auth remains responsible for Tendnote sign-in and account linking, while provider connections represent product integration authorization. Future auth/linking should prefer the SSO and social providers Better Auth supports directly rather than treating generic OAuth or OIDC as the default abstraction. Google sign-in and feature-specific Google OAuth can begin in Phase 2C or later using Better Auth's social/linking APIs, but Phase 2B should stop at inert status records and account/settings affordances that do not request scopes or touch external provider data.

The provider-connection shape should also leave room for non-CRM future products built on Tendnote's memory system, such as work journals or bragbook-style contexts. That means the table should model provider keys and capability keys generically, while product phases decide which capabilities are active and what privacy rules apply.

Phase 2B should not add credential custody. Provider connection rows may store stable non-secret state such as provider key, capability key, status, display identity, authorized scope metadata, connected/revoked/error timestamps, and audit-facing error or revocation reasons. Access tokens, refresh tokens, encrypted token blobs, sync cursors, and provider API watermarks should wait for the first real OAuth/provider slice so token refresh, revocation, retention, and provider-specific privacy policy are implemented together.

Phase 2B should also not add a generic product-context, workspace, or multi-memory-scope abstraction. Tendnote's existing owner-scoped relationship data remains the only active product context for this phase; the provider/capability shape is generic only to avoid boxing out future integrations or future products.

Provider connection state changes should be audited when persisted product state changes, such as creating a connection row, changing status, recording an error, or marking a placeholder revocation state. Static "coming soon" UI and disabled connect affordances should not write audit entries because no product state changed.
