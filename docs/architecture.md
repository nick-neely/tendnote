# Tendnote Architecture

Phase 0 is a lean pnpm/Turborepo workspace:

- `apps/web`: Next.js App Router UI, Better Auth route handler, shadcn/ui, and AI Elements.
- `apps/agent`: Eve filesystem agent with instructions, first tool, skills, and evals.
- `packages/db`: Drizzle schema, migrations, local Postgres/Neon-compatible clients, query helpers, and seed data.
- `packages/domain`: Shared Zod schemas and TypeScript domain types.
- `packages/config`: Shared TypeScript configuration.
- `biome.json`: Root lint, format, and import-order configuration.

Local development defaults to Docker Postgres and Docker Redis. Production can use Neon by setting `DATABASE_URL` to the Neon connection string.

Import direction:

- Apps may import `@tendnote/db` and `@tendnote/domain`.
- `packages/db` may import `@tendnote/domain`.
- `packages/domain` must stay independent of apps and database implementation code.
- Eve-specific code stays in `apps/agent`.
