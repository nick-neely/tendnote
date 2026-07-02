# Local Development

Detailed setup for running Tendnote locally. For a high-level overview, start with the [README](../README.md).

## Prerequisites

- Node.js and `pnpm`
- Docker (for local Postgres and Redis)

## Setup

```bash
pnpm docker:up      # local Postgres (pgvector) + Redis
pnpm install
pnpm db:migrate     # apply committed migrations
pnpm db:seed        # load demo data
```

Run `pnpm db:generate` only when you change the Drizzle schema and need a new migration file; committed migrations cover a fresh setup.

## Running the apps

```bash
pnpm dev        # web app on :3000; withEve spawns the Eve agent and serves
                # it same-origin, so this is all you need for web chat
pnpm dev:agent  # Eve agent only, standalone on :2000 (agent-isolated
                # debugging / the Eve TUI; do not run alongside `pnpm dev`)
```

The web chat is served same-origin: `apps/web/next.config.ts` wraps Next with `withEve()`, which spawns the Eve agent and proxies `/eve/v1/*` to it, so the browser streams turns with no Eve URL to configure.

## Local services

Local development uses Docker Postgres with pgvector and Redis on project-specific host ports `55432` and `56379` to avoid collisions with other local services. Production can point `DATABASE_URL` at Neon (which supports the `vector` extension) and `REDIS_URL` at a managed Redis-compatible service.

If you created the local database before pgvector was added, recreate the local Postgres volume once so the container uses the pgvector-capable image:

```bash
pnpm docker:down --volumes
pnpm docker:up
pnpm db:migrate
```

## Semantic embeddings

Semantic embeddings run through the same job lifecycle in every environment. Local development processes embedding jobs inline by default, so newly captured notes and approved memories become searchable immediately.

- With `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` set, embeddings use `TENDNOTE_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`) through the AI SDK.
- Without gateway credentials, local development falls back to deterministic fake vectors so capture and search still work offline.
- Set `TENDNOTE_EMBEDDING_RUNTIME=enqueue_only` to leave jobs for a worker instead of processing inline.

In production, extraction and embedding jobs are delivered through Vercel Queues with an outbox-style ledger and a recovery cron. None of that is needed locally — inline processing and deterministic adapters cover the path, and `pnpm verify` never touches a live queue. See [`background-job-delivery.md`](background-job-delivery.md) for the production foundation and the optional live smoke test.

## Eve evals

Phase 2F Eve-native evals run against a stable isolated Postgres database named
`tendnote_eval`, not the normal `tendnote` local database. The deterministic
command hard-resets that database, applies committed Drizzle migrations, loads
the same synthetic demo fixture data used by local development, and then runs
strict Eve evals with `DATABASE_URL` pointed at the eval database:

```bash
pnpm --filter @tendnote/agent eval:list
pnpm --filter @tendnote/agent eval:deterministic
```

Override `TENDNOTE_EVAL_DATABASE_URL` when the eval database is not on the
default Docker Postgres port. The reset guard only permits database names that
begin with `tendnote_eval`.

## Private beta access

Hosted environments gate the app behind Private Beta Access (Phase 2A). Local development does not need the Vercel Flags provider: with no authenticated session it admits the dev fallback owner (`TENDNOTE_DEV_OWNER_USER_ID`, defaulting to `demo-user`), so the app shell and Eve chat work without sign-in. See [`architecture.md`](architecture.md#access-and-private-beta).

Google capability linking still goes through Better Auth's `linkSocial` endpoint, which requires a real Better Auth session cookie. When you start a Google connect flow while using the local fallback owner, the account page first calls the dev-only `/api/dev/demo-session` bridge. That bridge creates or reuses a Better Auth user with the same id as the fallback owner, mints a local session cookie, and then lets `linkSocial` continue. Set `TENDNOTE_DEV_OWNER_EMAIL` in `apps/web/.env.local` to the Gmail address you use for local Google linking; the bridge also updates an existing fallback user when this local email changes. The route is unavailable in production.

## Environment variables

Configuration is **per app**, not a single root file. Each process only loads env files from its own directory, so copy each `.env.example` to a `.env.local` in the same folder.

| File | Loaded by | Copy from | Notable vars |
| --- | --- | --- | --- |
| `apps/web/.env.local` | the web app (`next dev`, from `apps/web`) | `apps/web/.env.example` | all optional locally (Postgres, Redis, dev Better Auth secret) |
| `apps/agent/.env.local` | the Eve agent (spawned by `withEve` from the web app, or `eve dev`) | `apps/agent/.env.example` | `AI_GATEWAY_API_KEY` (**required to drive the agent model**) |
| `.env` (repo root) | `docker compose` only | `.env.example` | optional `TENDNOTE_POSTGRES_PORT` / `TENDNOTE_REDIS_PORT` overrides |

Most app vars have working local defaults (Postgres, Redis, and a dev auth secret), so `AI_GATEWAY_API_KEY` (in `apps/agent/.env.local`) is the only one a typical local session needs — and only when running the conversational assistant. The web app's AI Gateway vars are server-only and optional; they matter only when web server actions/pages should generate live snapshots or real embeddings instead of using local fallbacks or enqueueing work for another process.

The root `.env` is read **only** by `docker compose`; Next.js and `eve dev` do not read it. Each `.env.example` documents the rest. `.env*` files are gitignored (except the `.env.example` templates), so your keys are never committed.

## Google integrations

Connecting Google Calendar or Gmail needs an operator to configure a Google Cloud OAuth client, consent screen, callback URLs, and the exact scopes Tendnote uses: Calendar event-read and Gmail compose. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/web/.env.local`. This is human-in-the-loop work that code slices cannot complete. See [`google-setup.md`](google-setup.md) for the step-by-step guide and local/hosted smoke checklists.

## Private beta flags

Phase 2A keeps hosted access private by default through the Vercel-managed `private-beta-access` boolean flag. The app sends the trusted Better Auth user entity on every evaluation:

```text
user.id
user.email
```

In the Vercel dashboard, define a `User` entity with `id` and `email` string attributes, create a production beta segment such as `Private Beta Users - Production`, and target that segment to return `true` for `private-beta-access`. Leave the flag default as `false`.

Vercel deployments receive the OIDC token automatically. For local dashboard-backed evaluation, run `vercel link` once for `apps/web`, then `vercel env pull` into `apps/web/.env.local`. `FLAGS_SECRET` only protects the Flags Explorer discovery endpoint at `/.well-known/vercel/flags`; it is separate from flag evaluation credentials.

## Quality gates

```bash
pnpm verify   # typecheck, lint, test, build
```

Tendnote uses Biome for linting, formatting, and import organization:

```bash
pnpm lint           # Biome check
pnpm lint:fix       # Biome safe fixes
pnpm format:check   # formatter check only
pnpm format         # formatter writes only
```

## CI workflows

- `.github/workflows/pr-verify.yml` is the pull request wrapper.
- `.github/workflows/reusable-verify.yml` runs database replay, Biome, tests, typecheck, and build as parallel jobs with an aggregate `Verify` job.
- `.github/workflows/production-migrations.yml` gates production Drizzle migrations behind reusable verification and expects `PRODUCTION_DATABASE_DIRECT_URL` in the production GitHub environment.
