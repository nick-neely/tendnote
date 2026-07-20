# Tendnote

Tendnote is a private, consent-first memory for your life — the people you care about, the things you own, and the work you keep meaning to get to. It remembers context you give it, surfaces it when it's useful, and helps you follow up thoughtfully.

It is not a sales CRM. There are no pipelines, no lead scores, and no autonomous outreach. Nothing leaves Tendnote without you approving it.

## What it does

### People

- **Capture** people, notes, and memories through the web app or by talking to Eve, the built-in assistant.
- **Review** what Eve suggests before it becomes real — approve, edit, or dismiss suggested memories and follow-ups from the person page, the dashboard review queue, or chat.
- **Recall** a person's context as a snapshot, search your stored context by exact wording, or search it by meaning.
- **Follow up** with person-linked reminders you create or Eve proposes — complete, snooze, dismiss, or reopen.
- **Plan** across everyone with a read-only agenda: "anything coming up next week?"
- **Get briefed** with small persisted daily and weekly relationship briefs.
- **Draft** thoughtful messages inside Tendnote — grounded in the memories and records that justify them, reviewable, and never sent for you.

### Actions and routines

Durable to-dos for *yourself*, separate from person follow-ups. Create one-off Actions ("renew the passport"), Routines on a simple cadence ("replace the water filter every 6 months"), or unscheduled "someday" items. Group them into Areas, work them from a focused Today view, and let Eve propose grounded suggestions you review before anything becomes active.

### Assets

The things you own, and what you know about them. An Asset holds typed memories (model numbers, purchase dates, warranty windows), evidence files like receipts and photos, links to related people and Actions, and a rebuildable context snapshot. Eve can propose asset facts and maintenance or renewal reminders — all review-gated.

### Sharing and scope

Every record carries a visibility scope: private, shared with selected household members, or visible to a whole household workspace. Scope is enforced in the query layer, so retrieval, search, and Eve all honor it. Household *management* (creating a household, inviting members) is not yet a product surface — households are provisioned through seed data today.

### Connected services

All connections are opt-in, individually consented, and narrowly scoped.

| Service | What Tendnote does | What it never does |
| --- | --- | --- |
| **Google Calendar** | Reads events read-only for calendar context in chat, brief highlights, and deterministic post-meeting follow-up suggestions | Write to your calendar, store raw provider payloads, create people from attendees |
| **Gmail** | Creates or updates a Gmail draft from a Tendnote draft you approved | Send email, read your mail, reconcile mailbox state |
| **Google Contacts** | Powers an explicit import preview you confirm row by row | Auto-create people, store raw People API payloads |
| **Discord** | Optional private capture channel and proactive delivery of briefs, aftercare, and action summaries | Read channels it wasn't invited to, act without your configured delivery targets |

Disconnecting revokes the grant, clears cached data, and blocks further reads.

## Quick start

```bash
pnpm docker:up      # local Postgres (pgvector) + Redis
pnpm install
pnpm db:migrate     # apply committed migrations
pnpm db:seed        # load demo data
pnpm dev            # web app on :3000, Eve mounted same-origin
```

Requires Node 24 and pnpm 10.32.1 (both pinned in `package.json`), plus Docker.

The only secret a typical local session needs is `AI_GATEWAY_API_KEY` in `apps/agent/.env.local`, and only to drive the conversational assistant. Everything else has a working local default. For full setup, environment variables, and troubleshooting, see [`docs/local-development.md`](docs/local-development.md).

## How it's built

A lean Turborepo with pnpm workspaces:

| Workspace | What's in it |
| --- | --- |
| [`apps/web`](apps/web/README.md) | Next.js App Router UI — dashboard, people, actions, assets, account and integration settings, Better Auth, the private-beta gate, and the background-job queue consumers |
| [`apps/agent`](apps/agent/README.md) | Eve — tools, skills, subagents, the Discord channel, and the scheduled-workflow dispatcher. Mounted same-origin into the web app via `withEve()`, so the browser streams chat with no separate agent URL |
| `packages/db` | Drizzle schema, migrations, and owner-scoped queries over Postgres with pgvector, plus the background-job stores |
| `packages/domain` | Shared Zod schemas and domain types |
| `packages/auth` | Shared Better Auth server baseline, so the web app and Eve verify the same sessions |
| `packages/rate-limit` | Cost-category product rate limiting with a pluggable store |
| `packages/config` | Shared TypeScript configuration |

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together and [`docs/security.md`](docs/security.md) for the privacy and trust boundaries.

## Quality gates

```bash
pnpm verify   # typecheck, lint, test, build
```

CI runs a stricter path than `pnpm verify`: it collects Istanbul coverage (`pnpm coverage:ci`) and runs the Fallow codebase-intelligence gate (`pnpm fallow:coverage:check`, `pnpm fallow:ci`). Run `pnpm fallow` locally to see what that gate sees.

Tendnote uses Biome for linting, formatting, and import organization. See [`docs/local-development.md`](docs/local-development.md#quality-gates) for individual commands, eval commands, and CI setup.

## Docs

- [`docs/local-development.md`](docs/local-development.md) — setup, environment variables, evals, CI
- [`docs/architecture.md`](docs/architecture.md) — system design and boundaries
- [`docs/security.md`](docs/security.md) — privacy model and trust boundaries
- [`docs/google-setup.md`](docs/google-setup.md) — Google OAuth client setup
- [`docs/discord-setup.md`](docs/discord-setup.md) — Discord app, capture, and delivery setup
- [`docs/background-job-delivery.md`](docs/background-job-delivery.md) — production queue foundation
- [`docs/prd.md`](docs/prd.md) — product roadmap · [`AGENTS.md`](AGENTS.md) — agent-facing guidance
