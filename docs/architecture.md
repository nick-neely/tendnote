# Tendnote Architecture

Tendnote is a lean pnpm/Turborepo workspace:

- `apps/web`: Next.js App Router UI, Better Auth route handler, shadcn/ui, AI Elements, the dashboard (assistant panel beside a tabbed rail — Today's birthdays and the daily/weekly briefs, follow-ups, memory review, and people), and the people list and person profile pages. The assistant panel streams chat turns from the same-origin Eve mount via `useEveAgent`. `next.config.ts` wraps the config with `withEve()` (mounting `apps/agent`); `src/proxy.ts` injects the authenticated owner on `/eve/v1/*`; `src/lib/eve` renders persisted tool results.
- `apps/agent`: Eve filesystem agent with instructions, skills, evals, the implemented tools, the `channels/eve.ts` HTTP channel the web app mounts same-origin via `withEve()`, and the `schedules/brief-dispatcher.ts` that generates persisted briefs. See [`apps/agent/README.md`](../apps/agent/README.md).
- `packages/db`: Drizzle schema, migrations, local Postgres/Neon-compatible clients, owner-scoped query helpers (people, memories, source records, context snapshots, follow-ups, relationship agenda, briefs, brief schedules, drafts, Exact Recall, and semantic retrieval), Postgres-owned background job stores (suggested-memory extraction and semantic embeddings), and seed data.
- `packages/domain`: Shared Zod schemas and TypeScript domain types.
- `packages/config`: Shared TypeScript configuration.
- `biome.json`: Root lint, format, and import-order configuration.

Local development defaults to Docker Postgres (pgvector) and Docker Redis. Production can use Neon by setting `DATABASE_URL` to the Neon connection string.

## Retrieval and background jobs

Tendnote retrieves relationship context in layers, all behind owner-scoped query helpers in `packages/db`: snapshot-backed person context, Postgres full-text Exact Recall over canonical records, and pgvector semantic retrieval over approved memories and eligible logged source records. Hard filters (owner, scope, sensitivity, memory status) are applied before any ranking.

Suggested-memory extraction and semantic embeddings run as Postgres-owned jobs that share the same lifecycle. Local development processes them inline so capture and approval stay responsive while newly captured context becomes searchable immediately; production can leave the work for a separate worker (`TENDNOTE_EMBEDDING_RUNTIME=enqueue_only`). Mutations enqueue or mark embedding work stale rather than blocking on an embedding API call (ADR 0013). Suggested-memory extraction runs through an LLM adapter as the production path, falling back to a deterministic adapter for tests and offline local development (ADR 0063). The production queue delivery foundation, recovery path, and optional live smoke test are documented in `docs/background-job-delivery.md`.

## Briefs and schedules

Daily and weekly relationship briefs are persisted records selected deterministically from the shared relationship agenda (due follow-ups, birthdays, review items, recent context, semantic matches); an optional LLM summary line is presentation-only and never chooses items (ADR 0062). Generation is idempotent per owner, local date, and cadence. A single static Eve dispatcher schedule (`agent/schedules/brief-dispatcher.ts`) claims due Tendnote-owned schedule rows and calls the shared owner-scoped generator directly rather than starting a chat session per brief (ADR 0066). Message drafts (Phase 1G) are Tendnote-owned only: they persist the source references that grounded them and are never sent or pushed to an external service.

## Web chat to agent

`apps/web/next.config.ts` wraps Next with `withEve()`, which spawns the Eve agent (`apps/agent`) and proxies `/eve/v1/*` to it at the same origin. The assistant panel streams turns directly with `useEveAgent` (`eve/react`) — no server-side turn proxy, no Eve URL, no CORS (ADR 0061). `src/proxy.ts` runs in the Node.js runtime and validates the Better Auth session on `/eve/v1/*`, strips any client-supplied owner, and injects the trusted owner header that `channels/eve.ts` maps onto the Eve session principal (ADR 0001). The browser cannot forge it, so the agent keeps its simple header-trust channel auth. Eve sessions provide short-term multi-turn continuity; durable product state stays in source records, memories, and follow-ups (ADR 0029, ADR 0030).

Import direction:

- Apps may import `@tendnote/db` and `@tendnote/domain`.
- `packages/db` may import `@tendnote/domain`.
- `packages/domain` must stay independent of apps and database implementation code.
- Eve-specific code stays in `apps/agent`.
