# Eve Eval Foundation

Phase 2F reserves `apps/agent/evals` for Eve-native `.eval.ts` files discovered by
`eve eval`. Ordinary Vitest tests that protect product rules, source scans, tool
wrapper behavior, or render contracts belong at the owning seam.

## Legacy Agent Eval Disposition

The Phase 2F relocation pass moved every legacy `apps/agent/evals/*.test.ts`
file into `apps/agent/agent/__tests__/`. These checks still run as Vitest tests
through `pnpm --filter @tendnote/agent test`, but they no longer live in the Eve
eval discovery area.

| Legacy file | Disposition |
| --- | --- |
| `active-eve-tree.test.ts` | Moved to `apps/agent/agent/__tests__/active-eve-tree.test.ts`; owns agent tree source-scan boundaries. |
| `assistant-review-tools.test.ts` | Moved to `apps/agent/agent/__tests__/assistant-review-tools.test.ts`; owns thin agent tool adapter and render-contract checks. |
| `calendar-context-safety.test.ts` | Moved to `apps/agent/agent/__tests__/calendar-context-safety.test.ts`; owns agent Calendar read framing checks. |
| `calendar-read-tool.test.ts` | Moved to `apps/agent/agent/__tests__/calendar-read-tool.test.ts`; owns `list_calendar_events` wrapper behavior. |
| `calendar-to-gmail-handoff.test.ts` | Moved to `apps/agent/agent/__tests__/calendar-to-gmail-handoff.test.ts`; owns agent/web handoff boundary scans. |
| `capture-memory-tool.test.ts` | Moved to `apps/agent/agent/__tests__/capture-memory-tool.test.ts`; owns `capture_memory` wrapper behavior. |
| `capture-source-record-tool.test.ts` | Moved to `apps/agent/agent/__tests__/capture-source-record-tool.test.ts`; owns `capture_source_record` wrapper behavior. |
| `create-message-draft-tool.test.ts` | Moved to `apps/agent/agent/__tests__/create-message-draft-tool.test.ts`; owns `create_message_draft` wrapper behavior. |
| `create-person-tool.test.ts` | Moved to `apps/agent/agent/__tests__/create-person-tool.test.ts`; owns `create_person` wrapper behavior. |
| `drafting-instructions.test.ts` | Moved to `apps/agent/agent/__tests__/drafting-instructions.test.ts`; owns drafting instruction source checks. |
| `embedding-queue.test.ts` | Moved to `apps/agent/agent/__tests__/embedding-queue.test.ts`; owns agent embedding queue adapter checks. |
| `explicit-person-creation.test.ts` | Moved to `apps/agent/agent/__tests__/explicit-person-creation.test.ts`; owns person-creation instruction source checks. |
| `extraction-queue.test.ts` | Moved to `apps/agent/agent/__tests__/extraction-queue.test.ts`; owns agent extraction queue adapter checks. |
| `get-person-context-tool.test.ts` | Moved to `apps/agent/agent/__tests__/get-person-context-tool.test.ts`; owns `get_person_context` wrapper behavior. |
| `get-relationship-agenda-tool.test.ts` | Moved to `apps/agent/agent/__tests__/get-relationship-agenda-tool.test.ts`; owns `get_relationship_agenda` wrapper behavior. |
| `no-send-without-approval.test.ts` | Moved to `apps/agent/agent/__tests__/no-send-without-approval.test.ts`; owns no-send instruction and draft boundary checks. |
| `person-context-trust.test.ts` | Moved to `apps/agent/agent/__tests__/person-context-trust.test.ts`; owns trust-aware instruction checks. |
| `phase-1f-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/phase-1f-boundaries.test.ts`; owns Phase 1F agent-surface source scans. |
| `phase-1g-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/phase-1g-boundaries.test.ts`; owns Phase 1G drafting boundary scans. |
| `phase-2c-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/phase-2c-boundaries.test.ts`; owns Phase 2C Calendar agent-surface scans. |
| `phase-2d-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/phase-2d-boundaries.test.ts`; owns Phase 2D Gmail boundary scans. |
| `phase-2e-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/phase-2e-boundaries.test.ts`; owns Phase 2E Contacts import boundary scans. |
| `save-draft-to-gmail-tool.test.ts` | Moved to `apps/agent/agent/__tests__/save-draft-to-gmail-tool.test.ts`; owns `save_draft_to_gmail` wrapper behavior. |
| `search-people-tool.test.ts` | Moved to `apps/agent/agent/__tests__/search-people-tool.test.ts`; owns `search_people` wrapper behavior. |
| `search-relationship-context-tool.test.ts` | Moved to `apps/agent/agent/__tests__/search-relationship-context-tool.test.ts`; owns `search_relationship_context` wrapper behavior. |
| `search-semantic-context-tool.test.ts` | Moved to `apps/agent/agent/__tests__/search-semantic-context-tool.test.ts`; owns `search_semantic_context` wrapper behavior. |
| `semantic-boundaries.test.ts` | Moved to `apps/agent/agent/__tests__/semantic-boundaries.test.ts`; owns semantic retrieval boundary scans. |
| `tool-model-output.test.ts` | Moved to `apps/agent/agent/__tests__/tool-model-output.test.ts`; owns model-output projection contracts for agent tools. |

`instructions-source.ts` moved with the instruction tests as shared Vitest helper
code. Future Phase 2F work should add Eve-native files as `apps/agent/evals/*.eval.ts`
or nested `apps/agent/evals/**/*.eval.ts`.
