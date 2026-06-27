# Tendnote

Tendnote is a personal relationship memory and follow-up assistant — a private, consent-first notebook for the people in your life, not a sales CRM. It remembers context about the people you care about, surfaces it when you need it, and helps you follow up thoughtfully without turning relationships into tasks.

## What it does today

- **Capture** people, source records, and approved memories through the web app or the Eve chat agent.
- **Review** agent-suggested memories inline — approve or dismiss, with raw record ids never shown.
- **Recall** snapshot-backed person context, and search stored context by exact text or by meaning.

Follow-up management, daily briefs, message drafting, and Google/Gmail integrations are later phases. See [`docs/prd.md`](docs/prd.md) for the full roadmap.

## How it's built

A lean Turborepo with pnpm workspaces:

- `apps/web` — Next.js App Router UI, dashboard, people pages, Better Auth.
- `apps/agent` — the Eve agent (tools, skills, evals), mounted into the web app same-origin via `withEve()`, so the browser streams chat turns with no separate agent URL.
- `packages/db` — Drizzle schema, migrations, and owner-scoped queries over Postgres (with pgvector).
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
