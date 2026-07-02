# Eve Eval Foundation

Phase 2F reserves `apps/agent/evals` for Eve-native `.eval.ts` files discovered by
`eve eval`. Ordinary Vitest tests that protect product rules, source scans, tool
wrapper behavior, or render contracts belong at the owning seam.

## Legacy Agent Eval Disposition

The Phase 2F relocation pass moved every legacy `apps/agent/evals/*.test.ts`
file into `apps/agent/tests/`. These checks still run as Vitest tests
through `pnpm --filter @tendnote/agent test`, but they no longer live in the Eve
eval discovery area.

| Legacy file | Disposition |
| --- | --- |
| `active-eve-tree.test.ts` | Moved to `apps/agent/tests/active-eve-tree.test.ts`; owns agent tree source-scan boundaries. |
| `assistant-review-tools.test.ts` | Moved to `apps/agent/tests/assistant-review-tools.test.ts`; owns thin agent tool adapter and render-contract checks. |
| `calendar-context-safety.test.ts` | Moved to `apps/agent/tests/calendar-context-safety.test.ts`; owns agent Calendar read framing checks. |
| `calendar-read-tool.test.ts` | Moved to `apps/agent/tests/calendar-read-tool.test.ts`; owns `list_calendar_events` wrapper behavior. |
| `calendar-to-gmail-handoff.test.ts` | Moved to `apps/agent/tests/calendar-to-gmail-handoff.test.ts`; owns agent/web handoff boundary scans. |
| `capture-memory-tool.test.ts` | Moved to `apps/agent/tests/capture-memory-tool.test.ts`; owns `capture_memory` wrapper behavior. |
| `capture-source-record-tool.test.ts` | Moved to `apps/agent/tests/capture-source-record-tool.test.ts`; owns `capture_source_record` wrapper behavior. |
| `create-message-draft-tool.test.ts` | Moved to `apps/agent/tests/create-message-draft-tool.test.ts`; owns `create_message_draft` wrapper behavior. |
| `create-person-tool.test.ts` | Moved to `apps/agent/tests/create-person-tool.test.ts`; owns `create_person` wrapper behavior. |
| `drafting-instructions.test.ts` | Moved to `apps/agent/tests/drafting-instructions.test.ts`; owns drafting instruction source checks. |
| `embedding-queue.test.ts` | Moved to `apps/agent/tests/embedding-queue.test.ts`; owns agent embedding queue adapter checks. |
| `explicit-person-creation.test.ts` | Moved to `apps/agent/tests/explicit-person-creation.test.ts`; owns person-creation instruction source checks. |
| `extraction-queue.test.ts` | Moved to `apps/agent/tests/extraction-queue.test.ts`; owns agent extraction queue adapter checks. |
| `get-person-context-tool.test.ts` | Moved to `apps/agent/tests/get-person-context-tool.test.ts`; owns `get_person_context` wrapper behavior. |
| `get-relationship-agenda-tool.test.ts` | Moved to `apps/agent/tests/get-relationship-agenda-tool.test.ts`; owns `get_relationship_agenda` wrapper behavior. |
| `no-send-without-approval.test.ts` | Moved to `apps/agent/tests/no-send-without-approval.test.ts`; owns no-send instruction and draft boundary checks. |
| `person-context-trust.test.ts` | Moved to `apps/agent/tests/person-context-trust.test.ts`; owns trust-aware instruction checks. |
| `phase-1f-boundaries.test.ts` | Moved to `apps/agent/tests/phase-1f-boundaries.test.ts`; owns Phase 1F agent-surface source scans. |
| `phase-1g-boundaries.test.ts` | Moved to `apps/agent/tests/phase-1g-boundaries.test.ts`; owns Phase 1G drafting boundary scans. |
| `phase-2c-boundaries.test.ts` | Moved to `apps/agent/tests/phase-2c-boundaries.test.ts`; owns Phase 2C Calendar agent-surface scans. |
| `phase-2d-boundaries.test.ts` | Moved to `apps/agent/tests/phase-2d-boundaries.test.ts`; owns Phase 2D Gmail boundary scans. |
| `phase-2e-boundaries.test.ts` | Moved to `apps/agent/tests/phase-2e-boundaries.test.ts`; owns Phase 2E Contacts import boundary scans. |
| `save-draft-to-gmail-tool.test.ts` | Moved to `apps/agent/tests/save-draft-to-gmail-tool.test.ts`; owns `save_draft_to_gmail` wrapper behavior. |
| `search-people-tool.test.ts` | Moved to `apps/agent/tests/search-people-tool.test.ts`; owns `search_people` wrapper behavior. |
| `search-relationship-context-tool.test.ts` | Moved to `apps/agent/tests/search-relationship-context-tool.test.ts`; owns `search_relationship_context` wrapper behavior. |
| `search-semantic-context-tool.test.ts` | Moved to `apps/agent/tests/search-semantic-context-tool.test.ts`; owns `search_semantic_context` wrapper behavior. |
| `semantic-boundaries.test.ts` | Moved to `apps/agent/tests/semantic-boundaries.test.ts`; owns semantic retrieval boundary scans. |
| `tool-model-output.test.ts` | Moved to `apps/agent/tests/tool-model-output.test.ts`; owns model-output projection contracts for agent tools. |

`instructions-source.ts` moved with the instruction tests as shared Vitest helper
code. Future Phase 2F work should add Eve-native files as `apps/agent/evals/*.eval.ts`
or nested `apps/agent/evals/**/*.eval.ts`.

## Deterministic Harness

The first Eve-native harness uses a stable local eval database:

- Default eval database URL: `postgres://tendnote:tendnote@localhost:55432/tendnote_eval`.
- Override with `TENDNOTE_EVAL_DATABASE_URL` when needed.
- `pnpm --filter @tendnote/agent eval:prepare` recreates the eval database, applies committed Drizzle migrations, and seeds the existing synthetic demo data.
- `pnpm --filter @tendnote/agent eval:list` lists discovered Eve evals without running the model.
- `pnpm --filter @tendnote/agent eval:deterministic` runs `eval:prepare`, then `eve eval --tag deterministic --strict --skip-report --junit .eve/evals/junit.xml`.

The reset script refuses to reset any database whose name does not begin with
`tendnote_eval`, keeping the normal local `tendnote` database out of the eval
path.
