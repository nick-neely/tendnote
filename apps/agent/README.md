# @tendnote/agent

Eve, the Tendnote assistant — a filesystem agent mounted into the web app same-origin via `withEve()`, so the browser streams chat turns with no separate agent URL. Eve code stays isolated here; the rest of the product imports `@tendnote/db` and `@tendnote/domain` instead.

## Layout

- `agent/agent.ts` — model and build config. Model defaults to `anthropic/claude-sonnet-5`; override with `TENDNOTE_AGENT_MODEL`. The AI SDK and ordinary runtime dependencies stay external so Eve emits one chunk per tool without rebundling them during local startup.
- `agent/instructions/` — `base.md` (identity, standing rules, trust tiers) plus `current-date.ts`, a dynamic resolver that anchors each turn on the real date.
- `agent/tools/` — typed tools over owner-scoped `@tendnote/db` queries (see below).
- `agent/subagents/` — focused sub-agents with their own instructions and narrow toolsets.
- `agent/skills/` — Markdown playbooks: `capturing-and-review.md`, `recall.md`, `followups.md`, `actions.md`, `drafting.md`, `household-and-gifts.md`, `self-context.md`.
- `agent/channels/` — `eve.ts` (the same-origin HTTP channel and hosted trust boundary) and `discord.ts` (signature-verified Discord interactions).
- `agent/schedules/brief-dispatcher.ts` — the single static schedule that claims due Tendnote-owned rows and dispatches every scheduled workflow.
- `agent/lib/` — composition helpers: hosted Better Auth session verification, loopback-only local owner auth, owner resolution, Eve modes, Redis-backed ingress limits, the Google Calendar reader, the Cleanup Preview sandbox, Discord capture and scope resolution, and background-job enqueue/publish wiring. `agent/lib/tools/` holds shared tool definitions (calendar events, message drafts, search people, the relationship agenda, propose-followup) that both the root agent and subagents register, so a capability common to more than one node has one implementation.
- `evals/` — Eve-native `.eval.ts` cases across `policy/`, `behavior/`, `judged/`, and `architecture/`.
- `tests/` — Vitest boundary tests that must not be discovered as Eve evals or authored agent nodes.

## Tools

| Group | Tools |
| --- | --- |
| People | `search_people`, `create_person`, `update_person`, `get_person_context` |
| Global Capture | `capture_saved_item` (routes Saved Item, Action, Routine, Follow-Up, Person, approved Memory, Asset Review, or private Self Context outcomes; accepts `requestedScope: 'household'` for explicit household sharing at capture time), `change_saved_item_capture`, `undo_saved_item_capture`, `capture_memory`, `capture_source_record`, `list_saved_items` |
| Memory review | `list_suggested_memory_reviews`, `get_suggested_memory_review`, `approve_suggested_memory`, `dismiss_suggested_memory`, `archive_memory`, `propose_suggested_memory` |
| Follow-ups | `create_followup`, `propose_followup`, `update_followup_status`, `list_due_followups`, `list_suggested_followup_reviews`, `get_suggested_followup_review`, `accept_suggested_followup`, `dismiss_suggested_followup` |
| Retrieval | `search_global_recall` (grounded cross-record Exact/Related results), `search_relationship_context` (relationship Exact Recall), `search_semantic_context`, `get_relationship_agenda` |
| General Actions | `create_general_action`, `edit_general_action`, `update_general_action_status`, `list_general_actions`, `list_general_action_areas`, `suggest_general_action`, `plan_suggested_general_actions`, `list_suggested_general_action_reviews`, `get_suggested_general_action_review`, `accept_suggested_general_action`, `dismiss_suggested_general_action` |
| Assets | `search_assets`, `get_asset_context`, `create_asset`, `edit_asset`, `propose_asset_memories`, `propose_asset_actions` |
| Gift planning | `add_gift_idea`, `edit_gift_idea`, `remove_gift_idea`, `get_gift_plan`, `search_gift_plans` |
| Self Context | `remember_self_context`, `update_self_context`, `archive_self_context`, `restore_self_context`, `list_self_context`, `get_self_context_fact` |
| Household | `household_check_in` (the caller's own bounded Household check-in composition; no household, member, or scope argument) |
| Drafting | `create_message_draft` (Tendnote-only), `save_draft_to_gmail` (externalize an approved draft; never sends), `edit_draft_body`, `dismiss_draft`, `list_message_drafts` |
| Calendar | `list_calendar_events` (read-only, bounded) |
| Cleanup | `cleanup_preview` (parses messy input into review-only candidates; writes nothing) |
| Web research | `web_fetch`, `web_search` (provider-executed) - `web_chat` mode only |

Every mutation that creates durable state requires explicit user intent. Anything Eve originates lands as a *suggestion* for review. Global Capture routes explicit requests through the same owner-scoped product functions as the web app, and correction or undo targets the recorded outcome rather than asking the model to reconstruct what changed. Web research is bounded (HTTPS-only `web_fetch`, capped timeout and response size) and available only in `web_chat` mode; a query may be composed only from what the user said in the active turn, never from stored Tendnote context - see [`docs/security.md`](../../docs/security.md#outbound-web-research).

## Subagents

| Subagent | Role |
| --- | --- |
| `memory_curator` | Proposes review-only memory cleanup (`propose_memory_cleanup`) |
| `message_drafter` | Proposes ephemeral drafts; persistence still needs explicit intent |
| `relationship_strategist` | Reads the agenda, calendar, and drafts to propose follow-ups |
| `privacy_guard` | Reviewer only, no tools — deterministic scope enforcement stays authoritative |

Each subagent's own `tools/` directory registers only what that role needs: a shared definition from `agent/lib/tools/` where one exists, plus `disableTool()` sentinel files that turn off the framework defaults (`bash`, `read_file`, `write_file`, `glob`, `grep`, `web_fetch`) it does not use. `agent/tools/agent.ts` disables the framework's own `agent` tool on the root for the same reason: delegation runs through the four declared subagents, not a self-copy with the full root toolset.

## Modes and channels

`agent/lib/eve-modes.ts` holds the mode table: `web_chat`, `discord_capture`, `scheduled_workflow`, and `restricted`. A mode narrows which authored tools a session may use and never widens it, and it is resolved per turn from `ctx.session.auth.current` alone - the principal the channel's own auth stamped - so nothing the model or the browser writes can select one. `agent/tools/eve_mode_gate.ts` enforces it: a `defineDynamic` resolver rebinds every withheld tool name to a definition that runs nothing, because eve 0.32 lets a dynamic resolver override an authored tool but not delete one. Selected Person, Drafting, and Cleanup Preview are conversation context rather than modes; see [`docs/architecture.md`](../../docs/architecture.md#eve).

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
