# Agent Notes

The Phase 0 Eve app lives in `apps/agent/agent`.

- `instructions.md` defines Tendnote's core identity, memory rules, and approval gate.
- `agent.ts` selects the model through Vercel AI Gateway-compatible model strings.
- `tools/search_people.ts` is the first typed tool and reads from `@tendnote/db`.
- Placeholder schedules, channels, connections, subagents, and sandbox files preserve the target shape without enabling later-phase behavior.

Outbound actions are intentionally absent in Phase 0. Add external draft or send tools only after approval UI and eval coverage exist.
