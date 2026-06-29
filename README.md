# Tendnote

Tendnote is a personal relationship memory and follow-up assistant — a private, consent-first notebook for the people in your life, not a sales CRM. It remembers context about the people you care about, surfaces it when you need it, and helps you follow up thoughtfully without turning relationships into tasks.

## What it does today

Phase 1 proves the full private relationship loop with no external accounts or outbound actions:

- **Capture** people, source records, and memories through the web app or the Eve chat agent.
- **Review** agent-suggested memories and follow-ups inline — approve, edit, or dismiss from the person ledger, the dashboard rail, or chat, with raw record ids never shown.
- **Recall** snapshot-backed person context, and search stored context by exact text or by meaning (pgvector).
- **Follow up** with person-linked reminders you create or Eve suggests — complete, snooze, dismiss, or reopen.
- **Plan** across people with a read-only relationship agenda ("anything coming up next week?").
- **Brief** yourself with small persisted daily and weekly relationship briefs.
- **Draft** thoughtful messages inside Tendnote — source-grounded, reviewable, and never sent externally.

Hosted accounts are live behind a private-beta gate (Phase 2A): sign-up, sign-in, password reset, and an access-gated app shell, with unadmitted users held on a pending page. Google/Gmail/Calendar/Contacts integrations and shared household context are later phases. See [`docs/prd.md`](docs/prd.md) for the full roadmap.

## How it's built

A lean Turborepo with pnpm workspaces:

- `apps/web` — Next.js App Router UI, dashboard, people pages, Better Auth sign-up/sign-in, and a Vercel Flags private-beta access gate. Also hosts the background-job queue consumers and recovery cron.
- `apps/agent` — the Eve agent (tools, skills, the brief dispatcher schedule, evals), mounted into the web app same-origin via `withEve()`, so the browser streams chat turns with no separate agent URL. See [`apps/agent/README.md`](apps/agent/README.md).
- `packages/db` — Drizzle schema, migrations, and owner-scoped queries over Postgres (with pgvector), plus Postgres-owned background jobs (extraction, embeddings) delivered through a Vercel Queues + outbox foundation.
- `packages/domain` / `packages/config` — shared types/validation and shared config.

See [`docs/architecture.md`](docs/architecture.md) for details and [`AGENTS.md`](AGENTS.md) for agent-facing guidance.

## Quick start

```bash
pnpm docker:up      # local Postgres (pgvector) + Redis
pnpm install
pnpm db:migrate     # apply committed migrations
pnpm db:seed        # load demo data
pnpm dev            # web app on :3000, Eve agent mounted same-origin
```

The only secret a typical local session needs is `AI_GATEWAY_API_KEY` in `apps/agent/.env.local`, and only to drive the conversational agent. For full setup, environment variables, and troubleshooting, see [`docs/local-development.md`](docs/local-development.md).

## Quality gates

```bash
pnpm verify   # typecheck, lint, test, build
```

Tendnote uses Biome for linting, formatting, and import organization. See [`docs/local-development.md`](docs/local-development.md#quality-gates) for the individual commands and CI setup.
