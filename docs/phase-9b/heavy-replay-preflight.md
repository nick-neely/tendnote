# Heavy replay repair and next sample scope

The previous heavy sample stopped at attempted turn 30 because an explicitly
requested casual note was not captured. Light and typical completed at the old
source. This repair does not turn that partial heavy sample into a complete month.

## Repair and verification boundary

Eve 0.47.7's empty-response recovery appends an instruction to answer from existing
tool results and not re-run tools. The failed turn performed its person lookup,
then encountered this recovery and asked for confirmation rather than saving.

The version-specific pnpm patch changes only that recovery instruction: do not
repeat completed calls, but allow actions not yet completed under existing
instructions and approval requirements. It applies to both workspace consumers
of Eve, including normal product behavior, rather than only the cost eval. There
is no new automatic retry, forced capture, relaxed outcome assertion, or changed
approval policy. The recovery's existing single retry remains bounded.

`pnpm --filter @tendnote/agent exec vitest run tests/cost-replay-empty-response.test.mjs`
executes the installed runtime with a deterministic model fixture. Before the
patch, lookup succeeded but capture was omitted. After the patch, lookup then
capture completes once; recovery after an already completed capture also leaves
exactly one write. The fixture intentionally models the observed interpretation
of the old instruction. This proves the instruction/continuation contract, not
that a live model will always choose the correct tool. Existing approval-policy
tests separately cover denials and required approvals; these small runtime tests
do not provide an approval-context integration test.

The patch is pinned to `eve@0.47.7` in `pnpm-workspace.yaml` and the lockfile.
On an Eve upgrade, inspect upstream recovery behavior, port or remove the patch,
and run the runtime test. Do not silently remove it to make installation succeed.
The generated distribution is minified, so its patch diff includes a long line;
the sole intended change is the recovery instruction above.

Upstream still contained the original instruction when checked on 2026-09-20:
[tool-loop source](https://github.com/vercel/eve/blob/main/packages/eve/src/harness/tool-loop.ts).
[Mock-model documentation](https://github.com/vercel/eve/blob/main/docs/evals/overview.mdx)
describes deterministic local tool-loop testing.

## Workload checked before spending

The existing 600-turn workload stays unchanged. Its actual day partition is now
shared by the eval and a test, so tests exercise the scheduling function the run
uses. All 30 days contain 20 turns and one 64 KiB upload. There are 150 unique
seeded people, revisited every 150 turns.

| Request type | Month count | Required outcome |
| --- | ---: | --- |
| Casual note | 225 | One new private person-linked Source Record, no approved Memory |
| Explicit Memory with Follow-Up | 75 | One source, one approved Memory, one correctly dated open Follow-Up |
| Standalone Follow-Up | 25 | One correctly dated open Follow-Up, no approved Memory |
| Read-only recall | 275 | No new source, approved Memory, or Follow-Up |

Heavy has 300 captures and 100 Follow-Ups. Because captures alternate with other
turns and the person cycle has even length, its 300 captures land on 75 of the
150 seeded people. This is an existing synthetic distribution, not evidence of
real customer behavior. Do not silently change it to make a new run easier.

The first two days retain the original 40 turns, including failed turn 30:
20 captures (five explicit, 15 casual), 25 Follow-Ups (five paired, 20 standalone),
two uploads, and six scheduled checks. A smaller `turns` number with the original
ratios would generate a different workload and is not this preflight.

Date-routing tests cover the full month across year-end and leap-year boundaries.
Fresh-row assertions still require later captures for a revisited person to
create a new source. First reuse occurs on day eight; first weekly review occurs
on day seven. Final completion still requires all 94 scheduled checks, the full
upload count, and zero unfinished background jobs.

## Proposed paid sequence, not started

1. Run a **two-day heavy canary**, seeded with all 150 people, preserving the exact
   first 40 turns, daily sessions, uploads and scheduled work. Proposed cap: **$10**
   including reporting-write allowances and reservations. This is a spending bound,
   not an expected price. Assert every outcome and reconcile every request.
2. Only after reviewing that evidence, run **one full heavy month** from a fresh
   isolated database, with its own separately approved ceiling. Preserve the full
   600-turn workload. Keep the earlier completed light/typical evidence separate
   and disclose the runtime-source difference in any combined report.
3. Inspect day-two progress, day-seven weekly-review results, and day-eight person
   reuse during the run. These are observational checkpoints, not permission to
   skip failures, change prompts, retry mutations, or resume from an uncertain turn.

The current paid CLI still runs all three variants. Before requesting approval
for this sequence, wire explicit canary/heavy-only selection and distinct evidence
paths without changing workload ratios; record the selected days, source and
ceiling in metadata. Do not run the existing all-variant command and manually
interrupt it as a substitute. The earlier single-run approval has already been
used; no new provider inference was performed for this repair.

## Remaining risks and stop rules

- A live model can still ask a redundant question or pick the wrong tool even with
  the repaired instruction. The small paid canary tests natural behavior; the
  unpaid fixture cannot establish its failure rate.
- Longer sessions and growing context may expose failures absent from the first
  two days. Daily session boundaries remain in place. A canary pass is not a
  promise that the remaining 560 turns will pass.
- Later summaries, embeddings, date handling, person reuse and uploads retain
  their existing assertions and metering. Do not extrapolate partial heavy cost.
- Repeated/ambiguous transport failures, missing billing, insufficient reservation,
  unfinished jobs, or wrong database outcomes still stop the sample. Preserve all
  paid calls, including failed-turn costs, and reconcile before another sample.

Progress now records the last attempted day/turn, capture authority and execution
stage before sending. A failure in execution remains `sending`; after a settled
turn it becomes `checking-outcomes`; only validated results become `validated`.
These content-free fields distinguish attempted work from the completed counters
without relying on Eve's aggregate final reply from an earlier session.

## Delivery validation

`pnpm verify` passed, including the production build. `pnpm test:affected` and
`pnpm coverage:ci` passed; coverage includes all 1,719 agent tests and 2,148 active
web tests. After simplifying the deterministic model fixture, the final focused
runtime/workload suite passed all 11 tests, and
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` passed with no findings. The fixture
uses the existing cost-replay test naming convention so Fallow recognizes the
Vitest-discovered `.mjs` entry; no audit settings were relaxed.

The isolated unpaid smoke passed with 12 artificial requests, two Memories, two
Follow-Ups, zero Saved Items and zero unfinished background jobs. Agent typechecking
and changed-file lint also passed after the final workload-test edits. The patch
was reviewed to confirm that its only semantic change is the recovery instruction;
its generated blank context line is excluded from trailing-whitespace review.
No new paid inference or reporting query was made for this repair.
