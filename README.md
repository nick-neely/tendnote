# Tendnote

Tendnote is a private, consent-first memory for your life — the people you care about, the things you own, and the work you keep meaning to get to. It remembers context you give it, surfaces it when it's useful, and helps you follow up thoughtfully.

test-claa

It is not a sales CRM. There are no pipelines, no lead scores, and no autonomous outreach. Nothing leaves Tendnote without you approving it. Eve can do bounded public web research in chat, but it builds those queries only from what you said in that turn, never from your stored context.

## Read the evidence

If you are here to inspect how those privacy boundaries were designed and
tested, start with the [Canonical Case Study in the immutable reviewed-content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/case-studies/tendnote-agent-built-privacy.md).
It follows one bounded claim through the governing decision, the exact
deterministic-evaluation evidence, and the preserved git history. That is the
technical reader path; it is not a blanket correctness claim or a security
audit. The exact qualified integration/publication commit is reserved for
#488 after qualification.

## What it does

### Capture, Today, and recall

- **Capture from anywhere** with one mobile-first composer. Explicit notes, links, open questions, Actions, Routines, Follow-Ups, and memories go to their supported record family; inferred facts remain suggestions for review.
- **Start with Today**, a calm, bounded shortlist across relationships, Actions, Routines, Saved Items, review work, and fresh Calendar context. Deterministic policy remains authoritative if Eve is unavailable.
- **Search everything you can access** through one grounded result contract. Exact matches come before related matches, and every result links back to its canonical record and evidence.
- **Keep the leftovers intentionally** as Saved Items: notes, links, and open questions that do not belong in a richer record family yet. Promote them to Actions when they become actionable.
- **Keep About You current** with a small set of exact, explicit facts about yourself - add, correct, import, or archive them. Eve treats them as ground truth, never as inference.
- **Install Tendnote as a PWA** for a standalone mobile shell. On an opted-in installation, explicit Reminder Schedules can deliver one privacy-gated alert for eligible records.

### People

- **Capture** people, notes, and memories through the web app or by talking to Eve, the built-in assistant.
- **Review** what Eve suggests before it becomes real — approve, edit, or dismiss suggested memories and follow-ups from the person page, the dashboard review queue, or chat.
- **Recall** a person's context as a snapshot, search your stored context by exact wording, or search it by meaning.
- **Follow up** with person-linked reminders you create or Eve proposes — complete, snooze, dismiss, or reopen.
- **Plan** across everyone with a read-only agenda: "anything coming up next week?"
- **Plan a gift** for someone with household co-planners you choose; mark them as the surprise subject and they never see the plan or get a reminder for it.
- **Get briefed** with small persisted daily and weekly relationship briefs.
- **Draft** thoughtful messages inside Tendnote — grounded in the memories and records that justify them, reviewable, and never sent for you.

### Actions and routines

Durable to-dos for *yourself*, separate from person follow-ups. Create one-off Actions ("renew the passport"), Routines on a simple cadence ("replace the water filter every 6 months"), or unscheduled "someday" items. Group them into Areas, work them from Today, add one explicit alert when timing matters, and let Eve propose grounded suggestions you review before anything becomes active.

### Assets

The things you own, and what you know about them. An Asset holds typed memories (model numbers, purchase dates, warranty windows), evidence files like receipts and photos, links to related people and Actions, and a rebuildable context snapshot. Eve can create or edit an Asset directly when you explicitly ask; anything Eve infers on its own - facts, maintenance or renewal reminders - stays a review-gated suggestion.

### Sharing and scope

Every record carries a visibility scope: private, shared with selected household members, or visible to a whole household workspace. Scope is enforced in the query layer, so retrieval, search, and Eve all honor it.

### Household

Create a household and invite members by email; invitations are sent, resent, canceled, accepted, or declined explicitly. Active members share a Household home, calendar, event plans, and check-ins, layered on the same visibility scope every record already respects. Membership, roles, and departure live under Account > Household. There is no shared People directory or activity feed - People stay member-owned, shared only through explicit read-only Relationship Shares.

### Connected services

All connections are opt-in, individually consented, and narrowly scoped.

| Service | What Tendnote does | What it never does |
| --- | --- | --- |
| **Google Calendar** | Reads events read-only for calendar context in chat, brief highlights, and deterministic post-meeting follow-up suggestions | Write to your calendar, store raw provider payloads, create people from attendees |
| **Gmail** | Creates or updates a Gmail draft from a Tendnote draft you approved | Send email, read your mail, reconcile mailbox state |
| **Google Contacts** | Powers an explicit import preview you confirm row by row | Auto-create people, store raw People API payloads |
| **Discord** | Optional private capture channel and proactive delivery of briefs, aftercare, birthday and gift planning, and action summaries | Read channels it wasn't invited to, act without your configured delivery targets |

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
| [`apps/web`](apps/web/README.md) | Next.js App Router UI — Today, Capture, Search, people, actions, Saved Items, assets, PWA and reminder settings, Better Auth, the private-beta gate, and background-job queue consumers |
| [`apps/agent`](apps/agent/README.md) | Eve — tools, skills, subagents, the Discord channel, and the scheduled-workflow dispatcher. Mounted same-origin into the web app via `withEve()`, so the browser streams chat with no separate agent URL |
| `packages/db` | Drizzle schema, migrations, and owner-scoped queries over Postgres with pgvector, plus the background-job stores |
| `packages/domain` | Shared Zod schemas and domain types |
| `packages/auth` | Shared Better Auth server baseline, so the web app and Eve verify the same sessions |
| `packages/rate-limit` | Cost-category product rate limiting with a pluggable store |
| `packages/config` | Shared TypeScript configuration |

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together, [`SECURITY.md`](SECURITY.md) for vulnerability reporting, and [`docs/security.md`](docs/security.md) for the privacy and trust boundaries.

For repository contributions, start with [`CONTRIBUTING.md`](CONTRIBUTING.md).
Issues are open with no service-level agreement, and self-hosting support is
community-only; see the [community support policy](docs/support.md).

## Quality gates

```bash
pnpm verify   # typecheck, lint, test, build
```

CI runs a stricter path than `pnpm verify`: it collects Istanbul coverage (`pnpm coverage:ci`) and runs the Fallow codebase-intelligence gate (`pnpm fallow:coverage:check`, `pnpm fallow:ci`). Run `pnpm fallow` locally to see what that gate sees.

Tendnote uses Biome for linting, formatting, and import organization. See [`docs/local-development.md`](docs/local-development.md#quality-gates) for individual commands, eval commands, and CI setup.

## License and publication

Tendnote is distributed under the [AGPL-3.0-only](LICENSE) license. The two
Impeccable harness variants are redistributed under Apache-2.0; their upstream
provenance, release pin, applicable NOTICE result, and exact paths are recorded
in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The repeatable gate for
future third-party bundles is [`docs/agents/third-party-bundles.md`](docs/agents/third-party-bundles.md).

The repository keeps its complete git history. Deployment IDs and account
scopes in older verification records are historical qualification evidence, not
current configuration. Current URLs come from the configured canonical
`BETTER_AUTH_URL`; copy [`apps/web/.env.example`](apps/web/.env.example) and
replace its synthetic example values for an operator-owned deployment.

## Docs

- [`docs/local-development.md`](docs/local-development.md) — setup, environment variables, evals, CI
- [`docs/architecture.md`](docs/architecture.md) — system design and boundaries
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting and disclosure limits
- [`docs/security.md`](docs/security.md) — privacy model and trust boundaries
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — first-pull-request doorway and contribution boundaries
- [`docs/support.md`](docs/support.md) — no-SLA community support boundary
- [`docs/email-setup.md`](docs/email-setup.md) — Resend account, sending-domain DNS, and send checklist
- [`docs/google-setup.md`](docs/google-setup.md) — Google OAuth client setup
- [`docs/self-hosting/vercel-operator-runbook.md`](docs/self-hosting/vercel-operator-runbook.md) — operator-owned Vercel admission walkthrough
- [`docs/discord-setup.md`](docs/discord-setup.md) — Discord app, capture, and delivery setup
- [`docs/background-job-delivery.md`](docs/background-job-delivery.md) — production queue foundation
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — redistributed third-party provenance and licenses
- [`docs/README.md`](docs/README.md) — focused documentation landing page · [`AGENTS.md`](AGENTS.md) — agent-facing guidance
