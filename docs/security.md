# Security And Privacy

Tendnote stores personal relationship context. Treat the data as sensitive by default.

- Local development uses Docker Postgres and Redis. Do not point local dev at production data.
- Never commit `.env` files or personal seed data.
- Better Auth uses Postgres for durable auth records and Redis secondary storage for cache/rate-limit style data.
- External sends and external draft creation require explicit approval; no such tools exist yet, and no Gmail, Calendar, Contacts, or shared-household behavior ships before its phase has code-level privacy and approval boundaries.
- The web chat bridge scopes every Eve session to the owner the web app forwards on a server-set header; it is an internal bridge, not a public ingress.
- People are created only on explicit user intent, never inferred from ambiguous casual mentions.
- Context retrieval — snapshot loading, Exact Recall, and semantic search — applies owner, scope, sensitivity, and memory-status filters in the query layer before ranking. Restricted content is excluded unless directly requested.
- Semantic embeddings cover only approved memories and minimized retained source-record text, never raw provider dumps, and embedding jobs run through the same owner-scoped lifecycle as other background work.
- Sensitive memories must be excluded from briefs unless directly requested and authorized.
- Mutating data tools write audit log entries.
