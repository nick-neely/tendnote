# Tendnote

Tendnote is a personal relationship memory and follow-up assistant. The current build (through Phase 1B.5) covers the monorepo, local development services, the app shell, shared domain/database packages, Better Auth, and an Eve agent reachable from the web chat. The agent can search people, create people on explicit intent, capture source records and approved memories, load snapshot-backed person context, and render persisted review components. Follow-ups, daily briefs, message drafting, and Google/Gmail integrations are later phases.

For the full roadmap see `docs/prd.md`. For agent-facing project guidance, start with `AGENTS.md`.

## Local Development

1. Start local services:

   ```bash
   pnpm docker:up
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Generate and apply database migrations:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```

4. Configure environment variables (see [Environment variables](#environment-variables)).
   For a standard local setup only one is strictly required, and only if you want
   the conversational assistant: `AI_GATEWAY_API_KEY` in `apps/agent/.env.local`.

5. Run the apps:

   ```bash
   pnpm dev        # web app on :3000; withEve spawns the Eve agent and serves
                   # it same-origin, so this is all you need for web chat
   pnpm dev:agent  # Eve agent only, standalone on :2000 (agent-isolated
                   # debugging / the Eve TUI; do not run alongside `pnpm dev`)
   ```

Local development uses Docker Postgres with pgvector and Redis by default on project-specific host ports `55432` and `56379` to avoid collisions with other local services. Production can point `DATABASE_URL` at Neon, which supports the `vector` extension, and `REDIS_URL` at a managed Redis-compatible service.

If you created the local database before pgvector was added, recreate the local Postgres volume once so the container uses the pgvector-capable image:

```bash
pnpm docker:down --volumes
pnpm docker:up
pnpm db:migrate
```

### Environment variables

Configuration is **per app**, not a single root file. Each process only loads
env files from its own directory, so copy each `.env.example` to a `.env.local`
in the same folder:

| File | Loaded by | Copy from | Notable vars |
| --- | --- | --- | --- |
| `apps/web/.env.local` | the web app (`next dev`, from `apps/web`) | `apps/web/.env.example` | all optional locally (Postgres, Redis, dev Better Auth secret) |
| `apps/agent/.env.local` | the Eve agent (spawned by `withEve` from the web app, or `eve dev`) | `apps/agent/.env.example` | `AI_GATEWAY_API_KEY` (**required to drive the agent model**) |
| `.env` (repo root) | `docker compose` only | `.env.example` | optional `TENDNOTE_POSTGRES_PORT` / `TENDNOTE_REDIS_PORT` overrides |

The web chat is served same-origin: `apps/web/next.config.ts` wraps Next with
`withEve()`, which spawns the Eve agent and proxies `/eve/v1/*` to it, so the
browser streams turns with no Eve URL to configure. The root `.env` is read
**only** by `docker compose`; Next.js and `eve dev` do not read it. Most app vars
have working local defaults (Postgres, Redis, and a dev auth secret), so
`AI_GATEWAY_API_KEY` (in `apps/agent/.env.local`) is the only one a typical local
session needs — and only when running the conversational assistant. Each
`.env.example` documents the rest. `.env*` files are gitignored (except the
`.env.example` templates), so your keys are never committed.

## Quality Gates

Tendnote uses Biome for linting, formatting, and import organization.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Use `pnpm lint:fix` for Biome's safe fixes and `pnpm format` for formatter-only writes.

## GitHub Workflows

- `.github/workflows/pr-verify.yml` is the pull request wrapper.
- `.github/workflows/reusable-verify.yml` runs database replay, Biome, tests, typecheck, and build as parallel jobs with an aggregate `Verify` job.
- `.github/workflows/production-migrations.yml` gates production Drizzle migrations behind reusable verification and expects `PRODUCTION_DATABASE_DIRECT_URL` in the production GitHub environment.
