# Tendnote

Tendnote is a personal relationship memory and follow-up assistant. Phase 0 sets up the monorepo, local development services, the app shell, shared domain/database packages, Better Auth, and an Eve agent skeleton.

For agent-facing project guidance, start with `AGENTS.md`.

## Local Development

1. Copy `.env.example` to `.env` and replace `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
2. Start local services:

   ```bash
   pnpm docker:up
   ```

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Generate and apply database migrations:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```

5. Run the web app:

   ```bash
   pnpm dev:web
   ```

Local development uses Docker Postgres and Redis by default on project-specific host ports `55432` and `56379` to avoid collisions with other local services. Production can point `DATABASE_URL` at Neon and `REDIS_URL` at a managed Redis-compatible service.

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
