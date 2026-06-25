# Tendnote Architecture

Tendnote is a lean pnpm/Turborepo workspace:

- `apps/web`: Next.js App Router UI, Better Auth route handler, shadcn/ui, AI Elements, and the assistant panel. `src/lib/eve` holds the web chat bridge that forwards the authenticated owner to the Eve agent and renders persisted tool results.
- `apps/agent`: Eve filesystem agent with instructions, skills, evals, the implemented tools, and the `channels/eve.ts` HTTP channel the web bridge posts to.
- `packages/db`: Drizzle schema, migrations, local Postgres/Neon-compatible clients, owner-scoped query helpers, and seed data.
- `packages/domain`: Shared Zod schemas and TypeScript domain types.
- `packages/config`: Shared TypeScript configuration.
- `biome.json`: Root lint, format, and import-order configuration.

Local development defaults to Docker Postgres and Docker Redis. Production can use Neon by setting `DATABASE_URL` to the Neon connection string.

## Web chat to agent

Web chat turns route through Eve so the assistant runs against the same owner-scoped data the web app authorizes. The web app resolves the owner from its session (or the local dev fallback) and forwards it on a server-set header; `channels/eve.ts` maps that header onto the Eve session principal (ADR 0001). This is an internal bridge, not a public ingress.

Import direction:

- Apps may import `@tendnote/db` and `@tendnote/domain`.
- `packages/db` may import `@tendnote/domain`.
- `packages/domain` must stay independent of apps and database implementation code.
- Eve-specific code stays in `apps/agent`.
