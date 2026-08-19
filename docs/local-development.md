# Local Development

Detailed setup for running Tendnote locally. For a high-level overview, start with the [README](../README.md).

## Prerequisites

- Node.js 24 (`volta` pins `24.18.0`; CI uses Node 24)
- pnpm 10.32.1 (pinned by `packageManager`; `corepack enable` picks it up automatically)
- Docker (for local Postgres and Redis)

## Setup

```bash
pnpm docker:up      # local Postgres (pgvector) + Redis
pnpm install
pnpm db:migrate     # apply committed migrations
pnpm db:seed        # load demo data
```

Run `pnpm db:generate` only when you change the Drizzle schema and need a new migration file; committed migrations cover a fresh setup. Two more database commands are useful day to day:

```bash
pnpm db:check    # drizzle-kit check — migration drift; CI runs this too
pnpm db:studio   # Drizzle Studio against the local database
```

## Running the apps

```bash
pnpm dev        # web app on :3000 + Eve agent on :2000, started in parallel
                # so Next does not wait for Eve's dev bundle before serving
pnpm dev:agent  # Eve agent only, standalone on :2000 (agent-isolated
                # debugging / the Eve TUI; do not run alongside `pnpm dev`)
```

The web chat is still served same-origin: the root `pnpm dev` passes
`EVE_BASE_URL=http://127.0.0.1:2000` to both apps, and
`apps/web/next.config.ts` uses `withEve()` to proxy `/eve/v1/*` to the parallel
agent. The browser therefore streams turns with no Eve URL to configure. If
you run the web package by itself, `withEve()` falls back to managing the Eve
dev process for that invocation.

## Local services

Local development uses Docker Postgres with pgvector and Redis on project-specific host ports `55432` and `56379` to avoid collisions with other local services. Production can point `DATABASE_URL` at Neon (which supports the `vector` extension) and `REDIS_URL` at a managed Redis-compatible service. `DATABASE_DRIVER` is optional and defaults to `postgres`; `DATABASE_DRIVER=neon-http` is rejected even against a Neon database, because Tendnote needs the transaction-capable driver.

If you created the local database before pgvector was added, recreate the local Postgres volume once so the container uses the pgvector-capable image:

```bash
pnpm docker:down --volumes
pnpm docker:up
pnpm db:migrate
```

## Semantic embeddings

Semantic embeddings run through the same job lifecycle in every environment. Local development processes embedding jobs inline by default, so newly captured notes and approved memories become searchable immediately.

- With `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` set, embeddings use `TENDNOTE_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`) through the AI SDK.
- Suggested Memory and General Action extraction use `TENDNOTE_EXTRACTION_MODEL` when set and otherwise default to `google/gemini-3.1-flash-lite`; an omitted tuning override never disables extraction.
- Without gateway credentials, local development falls back to deterministic fake vectors so capture and search still work offline.
- Set `TENDNOTE_EMBEDDING_RUNTIME=enqueue_only` to leave jobs for a worker instead of processing inline. `TENDNOTE_EXTRACTION_RUNTIME` and `TENDNOTE_CONTEXT_FACT_EXTRACTION_RUNTIME` are the same `inline` / `enqueue_only` toggle for the extraction and context-fact-extraction job families.
- Optional Today ranking is deterministic in development even when web gateway credentials are present. Set `TENDNOTE_ENABLE_TODAY_RANKING=1` in `apps/web/.env.local` to exercise the bounded live ranking path; a failure keeps the deterministic order and only unexpected errors get a concise server warning.

Several other model overrides follow the same fallback chain — the specific variable, then `TENDNOTE_AGENT_MODEL`, then `anthropic/claude-haiku-4.5`. All are optional tuning knobs:

| Variable | Used by |
| --- | --- |
| `TENDNOTE_SNAPSHOT_MODEL` | Person and asset context snapshots |
| `TENDNOTE_BRIEF_SUMMARY_MODEL` | The presentation-only brief summary line |
| `TENDNOTE_DRAFT_MODEL` | Message drafting |

Each Eve subagent also has its own override following the same pattern - `TENDNOTE_MEMORY_CURATOR_MODEL`, `TENDNOTE_MESSAGE_DRAFTER_MODEL`, `TENDNOTE_PRIVACY_GUARD_MODEL`, `TENDNOTE_RELATIONSHIP_STRATEGIST_MODEL` - set at `apps/agent/agent/subagents/<name>/agent.ts`.

In production, extraction and embedding jobs are delivered through Vercel Queues with an outbox-style ledger and a recovery cron. None of that is needed locally — inline processing and deterministic adapters cover the path, and `pnpm verify` never touches a live queue. See [`background-job-delivery.md`](background-job-delivery.md) for the production foundation and the optional live smoke test.

## Eve evals

Eve-native evals run against a stable isolated Postgres database named
`tendnote_eval`, not the normal `tendnote` local database. The deterministic
command hard-resets that database, applies committed Drizzle migrations, loads
the same synthetic demo fixture data used by local development, and then runs
strict Eve evals with `DATABASE_URL` pointed at the eval database:

```bash
pnpm --filter @tendnote/agent eval:list              # list Eve-native evals
pnpm --filter @tendnote/agent eval:deterministic     # strict deterministic evals
pnpm --filter @tendnote/agent eval:judged            # judged evals; skips silently without credentials
pnpm --filter @tendnote/agent eval:model-comparison  # compare models across the suite
```

`eval:deterministic` requires model credentials and fails fast without them; `eval:judged` skips silently when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is available, so it is safe to run unconfigured.

Override `TENDNOTE_EVAL_DATABASE_URL` when the eval database is not on the
default Docker Postgres port. The reset guard only permits database names that
begin with `tendnote_eval`.

## Private beta access

Hosted environments gate the app behind Private Beta Access. Local development does not need the Vercel Flags provider: with no authenticated session it admits the dev fallback owner (`TENDNOTE_DEV_OWNER_USER_ID`, defaulting to `demo-user`), so the app shell and Eve chat work without sign-in. See [`architecture.md`](architecture.md#access-and-private-beta).

Google capability linking still goes through Better Auth's `linkSocial` endpoint, which requires a real Better Auth session cookie. When you start a Google connect flow while using the local fallback owner, the account page first calls the dev-only `/api/dev/demo-session` bridge. That bridge creates or reuses a Better Auth user with the same id as the fallback owner, mints a local session cookie, and then lets `linkSocial` continue. Set `TENDNOTE_DEV_OWNER_EMAIL` in `apps/web/.env.local` to the Gmail address you use for local Google linking; the bridge also updates an existing fallback user when this local email changes. The route is unavailable in production.

## Environment variables

Configuration is **per app**, not a single root file. Each process only loads env files from its own directory, so copy each `.env.example` to a `.env.local` in the same folder.

| File | Loaded by | Copy from | Notable vars |
| --- | --- | --- | --- |
| `apps/web/.env.local` | the web app (`next dev`, from `apps/web`) | `apps/web/.env.example` | all optional locally (Postgres, Redis, dev Better Auth secret) |
| `apps/agent/.env.local` | the Eve agent (spawned by `withEve` from the web app, or `eve dev`) | `apps/agent/.env.example` | `AI_GATEWAY_API_KEY` (**required to drive the agent model**); matching `BETTER_AUTH_*`, Redis, and Google lifecycle credentials for live Calendar reads |
| `.env` (repo root) | `docker compose` only | `.env.example` | optional `TENDNOTE_POSTGRES_PORT` / `TENDNOTE_REDIS_PORT` overrides |

Most app vars have working local defaults (Postgres, Redis, and a dev auth secret), so `AI_GATEWAY_API_KEY` (in `apps/agent/.env.local`) is the only one a typical local session needs — and only when running the conversational assistant. The web app's AI Gateway vars are server-only and optional; they matter when web server actions/pages should generate live snapshots or real embeddings, or when you explicitly opt into Today ranking, instead of using local fallbacks or enqueueing work for another process.

The root `.env` is read **only** by `docker compose`; Next.js and `eve dev` do not read it. Each `.env.example` documents the rest. `.env*` files are gitignored (except the `.env.example` templates), so your keys are never committed.

## Transactional email

Household Invitations are the one email Tendnote sends. Locally you do not need a provider: with no `RESEND_API_KEY` set, the whole message — subject, body, and the acceptance link — is written to the `next dev` terminal, so you can walk the recipient's side by pasting the link into a browser. Setting `RESEND_API_KEY` plus an explicit `TENDNOTE_EMAIL_REPLY_TO` turns real sending on in any environment, which is how you smoke-test one send; `vitest` never sends whatever is configured. Production without either value refuses by name rather than writing a live capability URL into a hosted log. Sending domain, DNS records, and the send checklist: [`email-setup.md`](email-setup.md).

## Google integrations

Connecting Google Calendar or Gmail needs an operator to configure a Google Cloud OAuth client, consent screen, callback URLs, and the exact scopes Tendnote uses: Calendar event-read and Gmail compose. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/web/.env.local`. Eve also needs the same two credentials in `apps/agent/.env.local` when it must refresh an encrypted Calendar account during a non-request read or scheduled workflow. Eve uses those credentials only for Better Auth's lifecycle operation; the web app remains the owner of OAuth UI, callbacks, account linking, scopes, and reauthorization. This is human-in-the-loop work that code slices cannot complete. See [`google-setup.md`](google-setup.md) for the step-by-step guide and local/hosted smoke checklists.

## Discord

Discord capture and proactive delivery need a Discord application: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, and `DISCORD_BOT_TOKEN` in `apps/agent/.env.local`, plus `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` in `apps/web/.env.local` for account linking. `DISCORD_OWNER_USER_MAP` is a dev-only owner-resolution fallback and is never the hosted path. See [`discord-setup.md`](discord-setup.md) for the full walkthrough.

`TENDNOTE_BRIEF_TIMEZONE` (default `UTC`) sets the local-date boundary the scheduled-workflow dispatcher uses when deciding what is due.

## Private beta flags

Hosted access is private by default through the Vercel-managed `private-beta-access` boolean flag. The app sends the trusted Better Auth user entity on every evaluation:

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

### Fallow

`pnpm verify` does **not** run Fallow, but full CI does — so a clean local `verify` can still fail the PR gate. Full CI runs `pnpm coverage:ci` (V8 coverage, which Fallow consumes), then `pnpm fallow:coverage:check`, then `pnpm fallow:ci`. To see what that gate sees before pushing:

```bash
pnpm fallow             # full audit
pnpm fallow:health      # health score and hotspots
pnpm fallow:dead-code   # unused files, exports, types, dependencies
pnpm fallow:dupes       # duplicate code
```

To reproduce the CI gate exactly, run `pnpm coverage:ci && pnpm fallow:coverage:check && pnpm fallow:ci`.

## CI workflows

- `.github/workflows/pr-verify.yml` publishes the stable, inexpensive `Verify` check when a PR opens, reopens, or receives a new commit. Applying `full-ci` runs the expensive tier once and publishes a separate `Full CI qualification` check for that exact commit. Converting an already-qualified draft to ready does not start another workflow. A later commit keeps `Verify` current but has no full qualification, so remove and reapply `full-ci` when the final SHA is ready. Documentation-only changes receive the qualification check automatically without running the reusable verification lanes.
- `.github/workflows/reusable-verify.yml` runs the selected lanes in parallel. Vercel owns the deployable production build.
  - **Quality** — `pnpm lint`, `pnpm typecheck`.
  - **Fast tests** - affected package tests for iterative draft pushes, with Turbo's documented `TURBO_SCM_BASE=origin/main` override so the comparison uses the fetched default-branch baseline.
  - **Test and Fallow** (full tier) — `pnpm coverage:ci`, `pnpm fallow:coverage:check`, `pnpm fallow:ci`.
  - **Browser contract** (when web paths change) — Chromium contract tests.
  - **Instant browser matrix** (full tier, when Instant paths change) — routine Chromium coverage plus the promotion browser matrix.
  - **Database** (only when database paths change) - a database dependency-closure install, then `pnpm db:check` for drift and `pnpm db:migrate` against a pgvector service container.
- `.github/workflows/promotion-verify.yml` runs the same verification tier as `full-ci`, with the Instant Interaction browser matrix widened to add the reduced Firefox and WebKit smoke; it only runs via `workflow_dispatch` or the `full-browser-matrix` PR label, so it never gates a routine PR.
- `.github/workflows/playwright-cache.yml` primes the shared Chromium cache from `main` whenever the lockfile changes.
- `.github/workflows/eve-evals.yml` runs the deterministic Eve evals; it is `workflow_dispatch` only, so it never gates a PR.
- The `main` ruleset requires `Verify`, the exact-SHA `Full CI qualification`, and Vercel deployment before merge. After merge, Vercel sends `.github/workflows/production-migrations.yml` a `vercel.deployment.ready` repository dispatch for the staged production build. The workflow validates the project, environment, branch, and deployed SHA, then idempotently applies any pending Drizzle migrations using a database-only dependency install. Running the migration ledger on every ready deployment avoids missing schema work if Vercel coalesces multiple `main` builds. It reports the stable `Production Release Gate` commit status back to Vercel and expects `PRODUCTION_DATABASE_DIRECT_URL` in the production GitHub environment. Configure the repository variable `VERCEL_PROJECT_ID` to the operator's Vercel project id; the workflow deliberately does not embed a maintainer-owned project id. The RunsOn stack is the same-owner `.github-private` extension declared in `.github/runs-on.yml`.
- Configure the Vercel project to send repository dispatch events and require `Production Release Gate` as a Deployment Check. Vercel promotes the staged build only after that status succeeds; GitHub Actions no longer polls Vercel or invokes `vercel promote`.

Production schema changes must stay compatible with the currently live Vercel deployment. Use expand/contract releases for destructive changes: add the new shape first, switch application reads/writes after both old and new deployments can tolerate it, and remove old columns or tables only in a later release.
