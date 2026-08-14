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
- `pnpm --filter @tendnote/agent eval:deterministic` runs the full deterministic tag once, then resamples each failing eval twice against a freshly prepared database. The wrapper keeps the existing strict assertions and writes the aggregate result to `.eve/evals/junit.xml`.

The reset script refuses to reset any database whose name does not begin with
`tendnote_eval`, keeping the normal local `tendnote` database out of the eval
path.

### What a retry may recover, and what it must report

`scripts/deterministic-eval-retry.mjs` grades three outcomes rather than two:

| Outcome | Rule | Exit code | JUnit |
| --- | --- | --- | --- |
| Clean | Every sample passed. | `0` | plain `<testcase>` |
| Flaky | Failed its first sample and passed **every** retry. | `3` | `<flakyFailure>` |
| Failed | Any retry sample still failed. | `1` | `<failure>` |

A retry may recover one failure, because these evals drive a live model and a
single sampling wobble should not fail a run on its own. It may not make that
failure disappear: a recovered eval exits non-zero, is named on stderr, and is
marked flaky in the report. The previous policy scored "two of three samples" as
a plain pass, so an eval failing a third of the time was indistinguishable from
one that had never failed.

`skipped` is its own outcome and is **not** a pass. An eval that calls
`t.skip(reason)` is reported as skipped, never retried (resampling an intentional
skip only reproduces it), and excluded from the passing tally.

Because these evaluations make real model calls, they are intentionally outside
normal PR and production CI. Run the **Run Eve model evaluations** workflow
manually when changing Eve behavior, prompts, tools, or model routing. It is
`workflow_dispatch` only. The workflow runs Postgres and Redis services (the
agent builds its Better Auth and rate-limit clients against `REDIS_URL`, lazily,
so the declaration has to be true), passes `AI_GATEWAY_API_KEY` for the agent
model, bounds the job at 90 minutes, does not run judge-backed or
model-comparison tags, writes `.eve/evals/junit.xml`, and always uploads
`apps/agent/.eve/evals/` — including on the flaky exit, which is the run whose
artifacts are most worth reading.

## Suite shape: tags, files, helpers

Identity is the file path (`evals/policy/external-send-refusal.eval.ts` →
`policy/external-send-refusal`), and a file that default-exports an *array* of
evals fans out over indexed ids (`behavior/capture-precedence/0000`). Directories
group; **tags select what runs**.

| Tag | What runs it | What it means |
| --- | --- | --- |
| `deterministic` | `eval:deterministic` (the graded gate) | No judge. The agent is still a live model, so it still needs a gateway credential. |
| `judged` | `eval:judged` | Scored by the judge model as well as by gates. |
| everything else (`policy`, `behavior`, `assets`, `capture`, …) | `eve eval --tag <name>` ad hoc | Topical filters for a focused run. They gate nothing on their own. |

A tag no command runs is a file that never executes. There used to be an
`architecture` tag with four evals under it and no gate anywhere; three were
duplicates of `behavior` evals and were deleted, and the one unique eval
(`behavior/privacy-guard-wording-review`) moved into the deterministic gate.
Before adding a tag, decide which command runs it.

Two shared helper files sit beside the evals (any file not ending in `.eval.ts`
is not discovered as one):

- `evals/expectations.ts` — value-level matchers `eve/evals/expect` does not
  provide: `without(pattern)` for a negated match, `NO_RAW_IDS`, and
  `toolOutputs(events, toolName)` for asserting on what a tool actually
  *returned*.
- `evals/helpers.ts` — stream-level predicates, most importantly the subagent
  ones. eve 0.32 has `calledSubagent` but **no `notCalledSubagent`**, and
  `derived.toolCalls` holds authored tool calls only — so
  `notCalledTool("privacy_guard")` was true of every run ever recorded, including
  the ones that delegated to Privacy Guard on every step. `notCalledSubagent(t,
  name)`, `usedNoSubagents(t)`, and `usedNoToolsOrSubagents(t)` read the raw
  stream (`subagent.called` / `.started` / `.event` / `.completed`, which carry
  the name under `name` or `subagentName` depending on how the delegation ran).
  Replace them with the framework assertion if a later eve version grows one.
  `evals/judged/helpers.ts` holds `subagentOutput(turn, name)` for judged evals.

### Writing an eval that can fail

Every one of these was a real eval in this repo that could not fail:

- **A gate must be able to see what it forbids.** `notCalledTool` cannot see a
  subagent, and it cannot see a tool that does not exist — a ban on an
  unreachable tool proves nothing.
- **Text gates must not be satisfiable by echoing the prompt.** A refusal eval
  asserting `/send|email|draft|review|approval/` on a turn that says "Send an
  email" passes on "Sent the email to Alex."
- **A refusal asserts refusal language AND the absence of success language.**
  Bans are shaped like *claims* ("I'll pull the total off it once you upload"),
  never like topics ("OCR") — a refusal has to stay free to name what it refuses.
- **Prefer tool-call sequences and store effects to prose.** `toolOrder`,
  `calledTool({ input, count })`, and `eventsSatisfy` over tool *outputs* survive
  phrasing drift; a list of accepted sentences does not.
- **A negative-only eval passes when the feature is entirely broken.** Pair a
  "does not mutate on its own initiative" eval with one that proves the explicit
  mutation still works, or a regression that refuses everything ships green.
- **A judged eval grades what you hand it.** Pass the records as `on:`.

### Multi-turn evals and shared state

The eval database is prepared once per run and shared by every eval, and
`maxConcurrency` is 1 for that reason. An eval that writes should bring its own
subject rather than mutating a seeded row its neighbours read — completing the
seeded fridge-filter Routine, for instance, would quietly change what the asset
evals see. Multi-turn evals set their own `timeoutMs` (roughly the single-turn
budget per turn) instead of raising the default for the whole suite.

### Known coverage gaps

Two families cannot be evaluated from a live session as the harness stands, and
are covered by Vitest instead. Both are gaps in the *fixture*, not in the intent:

- **Gift Plan positive paths** (`get_gift_plan`, `add_gift_idea`,
  `edit_gift_idea`, `remove_gift_idea`). Every one of them needs a plan id from
  `search_gift_plans`, Eve cannot create a plan by design, and the demo seed has
  no Gift Plans. Seeding one would also destroy
  `policy/gift-plan-surprise-boundary`, which depends on the empty result reading
  as plain absence. The exclusion itself is proved exhaustively in
  `gift-plans/exclusion.test.ts`.
- **Eve mode narrowing.** The eval client authenticates through the web
  channel's own `AuthFn`, which stamps `channel: "eve"` → `web_chat`, where
  nothing is withheld; and the Discord route is a deterministic handler that
  never starts a model session. There is no way to obtain a `discord_capture`
  session from an eval, which is the point — a mode a caller could select would
  not be a boundary. `tests/eve-mode-gate.test.ts` covers the table, the
  withholding, and the stub's refusal reply.

The hosted-access boundary is a third: an eval session is always authenticated,
so a pending-access principal is unreachable. Its eval used to "prove" the rule
by comparing a hand-written literal to itself; it was deleted in favour of
`tests/eve-auth.test.ts`, which covers pending access, the forged owner header,
and the fail-closed ingress budget.

## Judge-Backed Quality Evals

Judge-backed quality evals are explicit and outside normal CI:

- `pnpm --filter @tendnote/agent eval:judged` runs `eve eval --tag judged --skip-report --junit .eve/evals/judged-junit.xml`.
- The command first prepares the isolated `tendnote_eval` database, then runs only evals tagged `judged`.
- It gates on `scripts/require-model-credentials.mjs` like `eval:deterministic`: a loud local skip, a hard CI failure.
- The default judge model is `openai/gpt-5.4-mini`; override it with `TENDNOTE_JUDGE_MODEL`.

Six judged evals cover recall groundedness, private draft usefulness,
relationship brief usefulness, relationship strategy quality, Cleanup Preview
usefulness, and Memory Curator usefulness.

Every judged eval passes the records the answer came from as the graded value
(`{ on: JSON.stringify({ reply, ...context }) }`). A judge handed only the reply
can grade prose and nothing else, so a criterion like "scoped to existing
Tendnote records" is unfalsifiable without the records beside it.

## Model Comparison

Model-comparison runs are explicit and outside normal CI:

- `pnpm --filter @tendnote/agent eval:model-comparison` runs the deterministic and judged eval tags for each configured candidate pair.
- `TENDNOTE_MODEL_COMPARISON_AGENT_MODELS` is a comma-separated list of agent model IDs. It defaults to `TENDNOTE_AGENT_MODEL` or `anthropic/claude-haiku-4.5`.
- `TENDNOTE_MODEL_COMPARISON_JUDGE_MODELS` is a comma-separated list of judge model IDs. It defaults to `TENDNOTE_JUDGE_MODEL` or `openai/gpt-5.4-mini`.
- The command skips with a clear message when neither `AI_GATEWAY_API_KEY` nor `VERCEL_OIDC_TOKEN` is available.
- The default JSON report is `.eve/evals/model-comparison/summary.json`; override with `TENDNOTE_MODEL_COMPARISON_OUT`.

The report records each agent/judge pair, deterministic pass/fail counts, judged
pass/scored counts, duration, token usage, and aggregate judge scores so quality,
privacy-boundary behavior, latency, and cost tradeoffs can be compared outside
the pull-request release gate.

## Credentials: run in CI, skip loudly locally

"Deterministic" means *no judge* — the agent itself is still a live model behind the AI
Gateway, so every eval tag needs a gateway credential. `apps/agent/scripts/require-model-credentials.mjs`
resolves the two environments differently, and never quietly:

- **Locally**, a missing `AI_GATEWAY_API_KEY`/`VERCEL_OIDC_TOKEN` prints a boxed SKIPPING
  banner and exits 0, so `pnpm verify` on a laptop without gateway access is not blocked by
  evals it cannot run.
- **In CI** (`CI` set), a missing credential is a hard failure. Skipping there would turn an
  unset secret into a green build.

A key in `apps/agent/.env.local` counts as present — `eve` loads that file itself.

## Phase 6 asset evals (#205)

`eve eval --tag assets` runs the Phase 6 Asset Memory evals. They answer from the seeded
asset world in `packages/db/src/demo-assets.ts` (a household refrigerator, its filter, a
co-member's private records, an unreviewed suggestion, and two already-dismissed reminder
proposals), so the same rows a developer sees in the dev app are the rows the evals reason
about.

| Eval | What it pins |
| --- | --- |
| `behavior/asset-water-filter-recall` | The proof scenario: the exact filter size, verbatim, with evidence named and no ids. |
| `policy/asset-household-privacy-boundary` | A co-member's private detail under a household Asset never surfaces, and is never hinted at. |
| `policy/asset-durable-write-boundary` | A fact the user states is proposed for review — never "saved", "logged", or "recorded". |
| `policy/asset-suggested-asset-boundary` | An unknown thing becomes a Suggested Asset with its typed fact, not an Asset created outright. |
| `policy/asset-reminder-proposal-boundary` | Asset reminders are proposed for review, never created as active Actions. |
| `policy/asset-dismissed-proposal-boundary` | A proposal the owner dismissed is never re-proposed and never re-offered (the nag rule, #203). |
| `policy/asset-evidence-capture-boundary` | Uploads route to the plus-menu; Eve never claims to read, parse, or OCR one — now or "once it's uploaded". |
| `policy/asset-evidence-destination-boundary` | An upload with an unclear destination attaches to an Asset the user confirms, never to a guess. |
| `policy/asset-out-of-scope-boundary` | No provider imports, spend dashboards, subscription management, or document library — and no promise of them later. |
| `policy/asset-autonomy-boundary` | No standing auto-approve, no asset graph. Review stays the door. |

Two properties of these evals are worth knowing before changing them:

- **They need a freshly prepared database.** `propose_asset_actions` writes a `suggested`
  action, and the proposal seam is idempotent per memory — so an eval that proposes only
  proposes once. `eval:deterministic` runs `eval:prepare` first, which is what makes the
  suite repeatable; a bare `eve eval` re-run against a used database will report false
  failures.
- **Absence assertions ban claims, not topics.** `evals/expectations.ts` exposes `without()`;
  a ban must match a *claim* ("I'll pull the total off it once you upload"), never a subject
  ("OCR", "budget"). A refusal has to be free to name the thing it is refusing ("I can't read
  files or run OCR"), or the eval fails the right answer.

These evals earned their keep before they were even committed. Two of them failed against the
product as it stood, and both failures were real: `get_asset_context` and
`propose_asset_actions` were unreachable because no tool output carried an `assetId` (fixed in
`2b3edf2`), and Eve — told to propose asset facts for review with no tool that could — claimed
to have "logged" a filter model she had not saved, and offered to extract receipt totals once
they were uploaded (fixed in `5385fb6` by giving her `propose_asset_memories`, the seam the
instructions had always promised). The evals are written to fail again if either comes back.

Deterministic coverage for the same phase — no model, no database — lives in three files:

- `packages/db/src/queries/assets/asset-policy.test.ts` — the security boundary (Asset
  Visibility, child-scope ceilings, review-gated writes, related-link inference, proactive
  surfacing, snapshot grounding), asked of every read surface at once.
- `packages/db/src/queries/phase-6-asset-memory-e2e.test.ts` — the proof scenario *composed*:
  asset hint → promotion → Suggested Asset → inferred details and captured evidence →
  edit-before-accept → durable memories → embedded and searchable → snapshot citing those
  records → a dated detail proposing a reminder → accepted onto the ledger and the Asset's
  profile → household scope, with a co-member's private child staying theirs alone. It found a
  real bug on its first run (batch review-accept never embedded what it accepted, so
  review-queue-accepted assets were absent from semantic search), which is the whole argument
  for walking the path instead of asserting the seams.
- `apps/agent/tests/phase-6-boundaries.test.ts` — the shape of Eve's asset surface, scanned
  recursively over every tool the agent ships, subagents included.
