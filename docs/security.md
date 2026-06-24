# Security And Privacy

Tendnote stores personal relationship context. Treat the data as sensitive by default.

- Local development uses Docker Postgres and Redis. Do not point local dev at production data.
- Never commit `.env` files or personal seed data.
- Better Auth uses Postgres for durable auth records and Redis secondary storage for cache/rate-limit style data.
- External sends and external draft creation require explicit approval and are out of Phase 0 scope.
- Sensitive memories must be excluded from briefs unless directly requested and authorized.
- Mutating data tools should write audit log entries when Phase 1 write tools are added.
