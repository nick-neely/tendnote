# Tendnote Architecture

Tendnote is a lean pnpm/Turborepo workspace:

- `apps/web`: Next.js App Router UI, Better Auth route handler, shadcn/ui, AI Elements, the dashboard (assistant panel plus a short "today" rail of upcoming birthdays and suggestions needing review), and the people list and person profile pages. The assistant panel streams chat turns from the same-origin Eve mount via `useEveAgent`. `next.config.ts` wraps the config with `withEve()` (mounting `apps/agent`); `src/middleware.ts` injects the authenticated owner on `/eve/v1/*`; `src/lib/eve` renders persisted tool results.
- `apps/agent`: Eve filesystem agent with instructions, skills, evals, the implemented tools, and the `channels/eve.ts` HTTP channel the web app mounts same-origin via `withEve()`.
- `packages/db`: Drizzle schema, migrations, local Postgres/Neon-compatible clients, owner-scoped query helpers (people, memories, source records, context snapshots, follow-ups, Exact Recall, and semantic retrieval), Postgres-owned background job stores (suggested-memory extraction and semantic embeddings), and seed data.
- `packages/domain`: Shared Zod schemas and TypeScript domain types.
- `packages/config`: Shared TypeScript configuration.
- `biome.json`: Root lint, format, and import-order configuration.

Local development defaults to Docker Postgres (pgvector) and Docker Redis. Production can use Neon by setting `DATABASE_URL` to the Neon connection string.

## Retrieval and background jobs

Tendnote retrieves relationship context in layers, all behind owner-scoped query helpers in `packages/db`: snapshot-backed person context, Postgres full-text Exact Recall over canonical records, and pgvector semantic retrieval over approved memories and eligible logged source records. Hard filters (owner, scope, sensitivity, memory status) are applied before any ranking.

Suggested-memory extraction and semantic embeddings run as Postgres-owned jobs that share the same lifecycle. Local development processes them inline so capture and approval stay responsive while newly captured context becomes searchable immediately; production can leave the work for a separate worker (`TENDNOTE_EMBEDDING_RUNTIME=enqueue_only`). Mutations enqueue or mark embedding work stale rather than blocking on an embedding API call (ADR 0013).

## Web chat to agent

`apps/web/next.config.ts` wraps Next with `withEve()`, which spawns the Eve agent (`apps/agent`) and proxies `/eve/v1/*` to it at the same origin. The assistant panel streams turns directly with `useEveAgent` (`eve/react`) — no server-side turn proxy, no Eve URL, no CORS (ADR 0061). `src/middleware.ts` runs in the Node.js runtime and validates the Better Auth session on `/eve/v1/*`, strips any client-supplied owner, and injects the trusted owner header that `channels/eve.ts` maps onto the Eve session principal (ADR 0001). The browser cannot forge it, so the agent keeps its simple header-trust channel auth. Eve sessions provide short-term multi-turn continuity; durable product state stays in source records, memories, and follow-ups (ADR 0029, ADR 0030).

Import direction:

- Apps may import `@tendnote/db` and `@tendnote/domain`.
- `packages/db` may import `@tendnote/domain`.
- `packages/domain` must stay independent of apps and database implementation code.
- Eve-specific code stays in `apps/agent`.
