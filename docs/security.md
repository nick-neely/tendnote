# Security And Privacy

Tendnote stores personal relationship context. Treat the data as sensitive by default.

- Local development uses Docker Postgres and Redis. Do not point local dev at production data.
- Never commit `.env` files or personal seed data.
- Better Auth uses Postgres for durable auth records and Redis secondary storage for cache/rate-limit style data.
- External sends and external draft creation require explicit approval; no such tools exist yet, and no Gmail, Calendar, Contacts, or shared-household behavior ships before its phase has code-level privacy and approval boundaries.
- Message drafting (Phase 1G) is Tendnote-internal only: drafts are reviewed, edited, copied, or marked sent manually — never sent or pushed to an external service — and they persist the source references (approved memories, source records, follow-ups, brief items) that grounded them rather than relying on prompt-only context.
- Hosted access is gated by Private Beta Access (Phase 2A): a Tendnote-owned access profile in Postgres is authoritative, the Vercel Flags evaluation uses the trusted Better Auth session entity (the browser cannot influence targeting), grants are persisted so admission survives flag-provider failures, and an unavailable provider fails closed. Pending users are held on a limited pending page with no access to relationship data or Eve.
- The web chat bridge scopes every Eve session to the owner the web app forwards on a server-set header and is gated on admitted access in `src/proxy.ts`; it is an internal bridge, not a public ingress.
- People are created only on explicit user intent, never inferred from ambiguous casual mentions.
- Context retrieval — snapshot loading, Exact Recall, and semantic search — applies owner, scope, sensitivity, and memory-status filters in the query layer before ranking. Restricted content is excluded unless directly requested.
- Semantic embeddings cover only approved memories and minimized retained source-record text, never raw provider dumps, and embedding jobs run through the same owner-scoped lifecycle as other background work.
- Sensitive memories must be excluded from briefs unless directly requested and authorized.
- Mutating data tools write audit log entries.
- Google Calendar (Phase 2C) is connected through Better Auth's Google provider with the single `calendar.events.readonly` scope; Better Auth owns OAuth token custody (encrypted at rest) and no Tendnote table stores provider tokens. Disconnect revokes/unlinks, clears the cache, and blocks further reads. Calendar reads are minimized event summaries only — never raw provider payloads — held in a short-lived cache that is not retrieval truth: cached/derived Calendar context (including brief items and suggestions) never enters full-text or semantic retrieval unless explicitly promoted into durable state. Calendar attendees match existing people by stable signals only and never auto-create people; Calendar-derived follow-ups stay `suggested` until accepted; prompt nudges only send text to Eve and never mutate state. Phase 2C adds no Gmail, Contacts, external sends, household behavior, or a broad recommendations system, and normal `pnpm verify` never requires live Google credentials or network access.
