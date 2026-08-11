# @tendnote/agent

Eve, the Tendnote assistant — a filesystem agent mounted into the web app same-origin via `withEve()`, so the browser streams chat turns with no separate agent URL. Eve code stays isolated here; the rest of the product imports `@tendnote/db` and `@tendnote/domain` instead.

## Layout

- `agent/agent.ts` — model and build config. Model defaults to `anthropic/claude-haiku-4.5`; override with `TENDNOTE_AGENT_MODEL`. The AI SDK and ordinary runtime dependencies stay external so Eve emits one chunk per tool without rebundling them during local startup.
- `agent/instructions/` — `base.md` (identity, standing rules, trust tiers) plus `current-date.ts`, a dynamic resolver that anchors each turn on the real date.
- `agent/tools/` — typed tools over owner-scoped `@tendnote/db` queries (see below).
- `agent/subagents/` — focused sub-agents with their own instructions and narrow toolsets.
- `agent/skills/` — Markdown playbooks: `capturing-and-review.md`, `recall.md`, `followups.md`, `actions.md`, `drafting.md`.
- `agent/channels/` — `eve.ts` (the same-origin HTTP channel and hosted trust boundary) and `discord.ts` (signature-verified Discord interactions).
- `agent/schedules/brief-dispatcher.ts` — the single static schedule that claims due Tendnote-owned rows and dispatches every scheduled workflow.
- `agent/lib/` — composition helpers: hosted Better Auth session verification, loopback-only local owner auth, owner resolution, Eve modes, Redis-backed ingress limits, the Google Calendar reader, the Cleanup Preview sandbox, Discord capture and scope resolution, and background-job enqueue/publish wiring.
- `evals/` — Eve-native `.eval.ts` cases across `policy/`, `behavior/`, `judged/`, and `architecture/`.
- `tests/` — Vitest boundary tests that must not be discovered as Eve evals or authored agent nodes.

## Tools

| Group | Tools |
| --- | --- |
| People | `search_people`, `create_person`, `update_person`, `get_person_context` |
| Global Capture | `capture_saved_item` (routes Saved Item, Action, Routine, or Follow-Up), `change_saved_item_capture`, `undo_saved_item_capture`, `capture_memory`, `capture_source_record` |
| Memory review | `list_suggested_memory_reviews`, `get_suggested_memory_review`, `approve_suggested_memory`, `dismiss_suggested_memory` |
| Follow-ups | `create_followup`, `propose_followup`, `update_followup_status`, `list_due_followups`, `list_suggested_followup_reviews`, `get_suggested_followup_review`, `accept_suggested_followup`, `dismiss_suggested_followup` |
| Retrieval | `search_global_recall` (grounded cross-record Exact/Related results), `search_relationship_context` (relationship Exact Recall), `search_semantic_context`, `get_relationship_agenda` |
| General Actions | `create_general_action`, `edit_general_action`, `update_general_action_status`, `list_general_actions`, `suggest_general_action`, `plan_suggested_general_actions`, `list_suggested_general_action_reviews`, `get_suggested_general_action_review`, `accept_suggested_general_action`, `dismiss_suggested_general_action` |
| Assets | `search_assets`, `get_asset_context`, `propose_asset_memories`, `propose_asset_actions` |
| Drafting | `create_message_draft` (Tendnote-only), `save_draft_to_gmail` (externalize an approved draft; never sends) |
| Calendar | `list_calendar_events` (read-only, bounded) |
| Cleanup | `cleanup_preview` (parses messy input into review-only candidates; writes nothing) |

Every mutation that creates durable state requires explicit user intent. Anything Eve originates lands as a *suggestion* for review. Global Capture routes explicit requests through the same owner-scoped product functions as the web app, and correction or undo targets the recorded outcome rather than asking the model to reconstruct what changed.

## Subagents

| Subagent | Role |
| --- | --- |
| `memory_curator` | Proposes review-only memory cleanup (`propose_memory_cleanup`) |
| `message_drafter` | Proposes ephemeral drafts; persistence still needs explicit intent |
| `relationship_strategist` | Reads the agenda, calendar, and drafts to propose follow-ups |
| `privacy_guard` | Reviewer only, no tools — deterministic scope enforcement stays authoritative |

## Modes and channels

`agent/lib/eve-modes.ts` defines five modes — `discord_capture`, `selected_person`, `drafting`, `scheduled_workflow`, `cleanup_preview` — and four callers/channels: `web`, `discord`, `schedule`, `sandbox`. Modes narrow what Eve may do for a given entry point; they never widen it.

The `eve.ts` channel is the hosted trust boundary: it verifies the Better Auth cookie directly, requires admitted Private Beta Access, charges the Eve ingress budget, and stamps only the verified owner onto the session principal (ADR 0194).

The `discord.ts` channel verifies Ed25519 interaction signatures against `DISCORD_PUBLIC_KEY`, answers Discord's PING, and handles slash commands, components, and modals. Capture writes a source record for review and enqueues extraction, action-extraction, and embedding jobs. Proactive delivery is opt-in and returns `null` when unconfigured. See [`docs/discord-setup.md`](../../docs/discord-setup.md).

## Scheduled workflows

`brief-dispatcher.ts` runs on one static schedule and dispatches four workflows, each with optional Discord delivery: due briefs (morning agenda and weekly relationship review), post-meeting aftercare, birthday and gift planning, and the scoped action summary. It calls shared owner-scoped generators directly rather than starting a chat session per workflow (ADR 0066). Hosted dispatch discovers durable granted owners from Private Beta Access profiles; `demo-user` remains local-only. `TENDNOTE_BRIEF_TIMEZONE` (default `UTC`) sets the local-date boundary.

## Run

```bash
# From the repo root:
pnpm dev          # web app + agent in parallel; web proxies Eve same-origin
pnpm dev:agent    # agent only, standalone on :2000 (Eve TUI / isolated debugging)
```

```bash
pnpm --filter @tendnote/agent eval:list              # list Eve-native evals
pnpm --filter @tendnote/agent eval:deterministic     # reset/migrate/seed tendnote_eval, run strict evals
pnpm --filter @tendnote/agent eval:judged            # judged evals; skips silently without model credentials
pnpm --filter @tendnote/agent eval:model-comparison  # compare models across the eval suite
```

`AI_GATEWAY_API_KEY` in `apps/agent/.env.local` is required to drive the model. See [`docs/local-development.md`](../../docs/local-development.md).
