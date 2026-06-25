# Agent Notes

The Eve app lives in `apps/agent/agent`.

- `instructions.md` defines Tendnote's core identity, memory rules, and approval gate.
- `agent.ts` selects the model through Vercel AI Gateway-compatible model strings.
- `channels/eve.ts` is the single HTTP ingress the web chat bridge posts a turn to; it scopes every Eve session to the owner the web app forwards (ADR 0001).
- `tools/` holds the implemented typed tools, all reading/writing through `@tendnote/db`: `search_people`, `get_person_context`, `create_person`, `capture_source_record`, `capture_memory`, `get_suggested_memory_review`, `approve_suggested_memory`, and `dismiss_suggested_memory`.
- `skills/` holds `relationship-memory.md` and `privacy-and-consent.md`.
- Keep the active Eve tree limited to implemented behavior. Do not preserve inactive future-phase placeholder schedules, connections, subagents, or sandbox files; add them back when the relevant phase has real code-level behavior.

Outbound actions are intentionally absent. People are created only on explicit user intent, never from ambiguous casual mentions. Add follow-up, brief, drafting, or external send/draft tools only in their phase, after approval UI and eval coverage exist.
