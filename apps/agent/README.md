# @tendnote/agent

Eve filesystem agent for Tendnote. Mounted into the web app same-origin via `withEve()`, so the browser streams chat turns with no separate agent URL. Eve code stays isolated here; the rest of the product imports `@tendnote/db` and `@tendnote/domain` instead.

## Layout

- `agent/agent.ts` — model and build config. Model defaults to `anthropic/claude-haiku-4.5`; override with `TENDNOTE_AGENT_MODEL`. `ai` is kept external so Eve emits one chunk per tool.
- `agent/instructions/` — `base.md` (identity, standing rules, trust tiers) plus `current-date.ts`, a dynamic resolver that anchors each turn on the real date.
- `agent/tools/` — typed tools over the owner-scoped `@tendnote/db` queries: people search/create/update, source-record and memory capture, suggested-memory and suggested-follow-up review, follow-up lifecycle, Exact Recall and semantic search, the relationship agenda, a read-only Google Calendar read (`list_calendar_events`), and Tendnote-only message drafting.
- `agent/lib/` — composition helpers: owner resolution, the Google Calendar reader (`calendar.ts` / `calendar-read.ts`, reading the connected calendar through the shared cache-aside seam; token custody stays in Better Auth), and the background-job enqueue/publish wiring.
- `agent/skills/` — Markdown playbooks: `capturing-and-review.md`, `recall.md`, `followups.md`, `drafting.md`.
- `agent/channels/eve.ts` — the same-origin HTTP channel; maps the web-set `x-tendnote-owner-id` header onto the Eve session principal (ADR 0001).
- `agent/schedules/brief-dispatcher.ts` — claims due Tendnote-owned brief schedule rows and calls the shared brief generator (ADR 0066).
- `evals/` — Eve-native `.eval.ts` cases discovered by `eve eval`.
- `tests/` — legacy Vitest wrapper and boundary tests that should not be discovered as Eve evals or authored agent nodes.

Keep the active tree lean — add schedules, channels, connections, subagents, and sandbox workflows only when their phase has real behavior (see [`docs/prd.md`](../../docs/prd.md)).

## Run

```bash
# From the repo root:
pnpm dev          # web app + agent same-origin via withEve (use this for web chat)
pnpm dev:agent    # agent only, standalone on :2000 (Eve TUI / isolated debugging)
```

```bash
pnpm --filter @tendnote/agent eval:list           # list Eve-native evals
pnpm --filter @tendnote/agent eval:deterministic  # reset/migrate/seed tendnote_eval, then run strict deterministic evals
```

`AI_GATEWAY_API_KEY` in `apps/agent/.env.local` is required to drive the model. See [`docs/local-development.md`](../../docs/local-development.md).
