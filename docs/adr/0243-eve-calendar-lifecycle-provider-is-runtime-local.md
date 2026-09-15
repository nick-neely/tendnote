# Eve Calendar Lifecycle Uses A Runtime-Local Better Auth Provider

ADR 0194 keeps feature-specific OAuth providers and hooks in the web app. That
remains true for OAuth routes, account linking, and product capability
reconciliation. The Calendar read path is a narrower exception: Eve's hosted
runtime may configure the same Google social provider only for Better Auth's
server-side `getAccessToken` lifecycle operation.

Better Auth 1.6.20 resolves and refreshes an OAuth account only when the auth
instance that calls `getAccessToken` has the provider's refresh configuration.
Eve has scheduled and non-request Calendar consumers, so it cannot delegate the
operation through a browser request or a session-header proxy. Keeping the
lifecycle-only provider configuration in Eve lets the shared Better Auth
operation decrypt, refresh, and persist the encrypted account tokens in the
runtime that owns the read, while the web app remains the only OAuth UI and
account-linking owner.

The exception is deliberately bounded:

- Eve configures Google only for token resolution and refresh. It exposes no
  Google OAuth route, callback, sign-in flow, account-linking hook, or product
  reconciliation hook.
- Eve does not read or decrypt account columns directly, mirror tokens into a
  Tendnote table, or persist a second token store.
- Web and Eve use the same Better Auth secret, database, Redis conventions, and
  Google client credentials. The web app remains the feature owner for scopes,
  consent, Provider Connection state, and reauthorization UI.
- A missing lifecycle configuration fails closed to the bounded Calendar cache;
  it never invents events or silently falls back to plaintext custody.
- Better Auth 1.6.20 masks token decryption, invalid-refresh-grant, and
  refresh-network failures as the same `FAILED_TO_GET_ACCESS_TOKEN` response.
  The shared boundary reauthorizes only explicit account/credential errors and
  treats that masked response as transient, preserving bounded stale cache
  rather than making an unprovable revoke claim. This is a limitation of the
  supported Better Auth API, not a second token-custody path.

This supersedes only the feature-specific OAuth-provider sentence in ADR 0194.
The hosted Eve authentication boundary and all other ADR 0194 requirements
remain in force.
