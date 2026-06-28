# Private Beta Access Uses Vercel Flags

Phase 2A should make Tendnote a real authenticated product while keeping hosted access private by default. The first successful signup becomes the initial allowed owner; later signups require Private Beta Access, evaluated server-side through Vercel Flags using user entities and beta segments rather than a static environment-variable allowlist. This keeps the beta gate operable from the Vercel dashboard and Flags Explorer while preserving `owner_user_id` as the product data ownership boundary and keeping the demo owner fallback local-development only.

Sign-up should create the Better Auth user before beta access is granted, then route unapproved users to a pending-access page instead of letting them enter the product. That gives Vercel Flags a stable `user.id` and `user.email` entity for targeting, avoids custom pre-auth signup behavior, and lets access be granted later without asking the user to create another account.

Pending-access users should not see the normal Tendnote app shell. They may see only a limited pending-access area with their signed-in identity, current access status, and sign-out/account controls; people, memories, briefs, drafts, settings beyond identity, and the Eve chat surface must not load until access is granted.

The initial owner and granted beta users should be persisted in a small Tendnote-owned account/access profile instead of derived from "oldest user" queries. Vercel Flags is the rollout decision input; the persisted profile records the durable product access state, source, timestamps, and later account metadata. This avoids brittle behavior around seed data, tests, deleted users, and future billing or role fields.

Phase 2A auth should support email/password, password reset, and GitHub sign-in. Google sign-in should not be the first social provider and should not be coupled to Calendar or Gmail authorization; those Google capabilities should be linked later with narrow, feature-specific OAuth scopes and explicit consent when the integration slice needs them.

The `demo-user` fallback may remain for explicit local development only. Production and preview deployments must require a real Better Auth session before reading or mutating Tendnote product data or before opening the same-origin Eve channel; tests should pass explicit owner ids instead of depending on the fallback.

Opening Tendnote beyond private beta should be a flag/segment rollout change, not a schema or auth-model rewrite. The application must still fail closed when flag evaluation is unavailable in production unless the signed-in user is already the initial allowed owner or otherwise has persisted access.
