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

## Paid sequence

1. Run a **two-day heavy canary**, seeded with all 150 people, preserving the exact
   first 40 turns, daily sessions, uploads and scheduled work. Approved cap: **$10**
   including reporting-write allowances and reservations. This is a spending bound,
   not an expected price. Assert every outcome and reconcile every request.
2. Only after reviewing that evidence, run **one full heavy month** from a fresh
   isolated database, with its own separately approved ceiling. Preserve the full
   600-turn workload. Keep the earlier completed light/typical evidence separate
   and disclose the runtime-source difference in any combined report.
3. Inspect day-two progress, day-seven weekly-review results, and day-eight person
   reuse during the run. These are observational checkpoints, not permission to
   skip failures, change prompts, retry mutations, or resume from an uncertain turn.

The owner subsequently approved one $10 canary. `eval:cost --canary` now selects
only heavy and runs its first two days without rescaling the workload. It requires
`TENDNOTE_COST_APPROVAL=heavy-canary-10-usd`; the old full-run acknowledgement is
rejected. Its inference/reporting-write meter is capped at $9.995, reserving $0.005
inside the $10 total for one provider reconciliation query. Output is isolated at
`evidence/cost/<source>/heavy-canary/`, and existing evidence cannot be overwritten.
Metadata identifies the two-day canary explicitly; completion is not a full-month
result. The full heavy-only mode remains future work and is not authorized by this
canary approval.

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

The canary runner's admission and budget tests pass (41 focused replay tests).
Its final unpaid smoke, agent typecheck, affected tests, full `pnpm verify`
(including build), and Fallow audit pass. The prior coverage report remains
applicable to the unchanged product runtime; this step changes only replay
scripts/evals, their tests and documentation.

## Completed canary, 2026-09-20

The [two-day canary evidence](../../evidence/cost/9eba1acd665a167d88902b129ad2738bafdad992/heavy-canary/README.md)
records all 40 turns, 20 captures, 25 Follow-Ups, two uploads and six scheduled
checks passing, including previously failing turn 30. There were 26 live
empty-response recovery events, but no failed required outcomes. All 337
requests settled without transport retries or uncertain charges.

Provider counts, tokens and inference reconcile completely. Provider charges
were $1.58550728; including the single $0.005 reporting-query allowance gives
$1.59050728 against the approved $10 ceiling. Web search remains excluded.
This completes the canary only. A full heavy-only runner and separately approved
ceiling remain the next step; the 600-turn month has not run at this source.

## Full heavy replay authorization

After reviewing the successful canary, the owner instructed us to continue with
one full run. `eval:cost --heavy` selects only the original 30-day heavy workload,
using the existing $50 replay ceiling and a distinct `heavy-month-50-usd`
acknowledgement. The meter reserves $0.005 inside that ceiling for one report
query. It starts from a fresh isolated database and writes `heavy-month` evidence;
light and typical do not rerun. Existing outcome assertions and stop rules remain.

## Full heavy replay result, 2026-09-20

The [full-run evidence](../../evidence/cost/de25a0d12183a84a70b973818b8bde7a780cd50d/heavy-month/README.md)
records 55 validated turns before the turn-56 source assertion stopped the sample.
The last session output belongs to the preceding recall; its terminal waiting
event appears twice, with no recorded receipt of the capture request. Investigate
and reproduce stale session-boundary handling before another paid attempt. This
is evidence for an eval/client sequencing problem, not a confirmed model refusal.

All 444 requests reconcile. Provider charges were $2.15668920; including the
single reporting-query allowance gives $2.16168920 against the $50 cap. There are
no uncertain requests or unfinished jobs. The full month remains incomplete, and
no automatic retry was launched.

## Session-boundary repair

Inspection of the failed run's local durable chunks found 518 distinct events.
The eval received 518 events too, but one persisted `message.appended` event was
missing and the last `session.waiting` event appeared twice. The missing event's
physical index was 512; the repeated waiting event was
`evt_01M2YSR89NXT7AV0JY4H3Q157W`. This is a delivery/count mismatch, not a duplicate
persisted event. Eve advances its client cursor by received-event count, so the
first read ended one event behind; the next send read the old boundary and the
eval accepted it as completion before the new capture ran.

The existing version-pinned Eve patch now also changes `ClientSession`'s
send/respond iterator. It remembers the last delivered boundary ID, counts every
raw event toward the cursor, and skips an exact repeat of that boundary before
exposing it to `MessageResponse` or the eval driver. A different boundary remains
visible, including a legitimate input/approval pause with no `turn.started` event.
It sends no extra POST, retries no mutation, and adds no sleep or timing assumption.
It stores one ID per client session, not an unbounded event history.

The regression uses the installed client and eval driver against a deterministic
HTTP fixture. The first live read omits a persisted text delta; the next GET uses
the client's real cursor to read the old boundary. Before the patch, the new
capture returned no response and a new approval pause was missed. After the patch,
three sequential requests receive their own responses with exactly one POST each;
approval continuation and cancellation of the current turn also work. The original
empty-response regression remains separate and passing.

Command: `pnpm --filter @tendnote/agent exec vitest run tests/cost-replay-session-boundary.test.mjs tests/cost-replay-empty-response.test.mjs`.

This repairs the observed premature-completion failure. It does not claim to fix
all local live-stream ordering/delivery behavior or restore a missing incremental
text event; the recorded completed message already contained the full text. Raw
stream/snapshot APIs are unchanged. Recheck this pinned client patch on an Eve
upgrade, alongside the existing tool-loop patch. No new paid sample was run for
this repair, and the full-month result remains outstanding.

The one General Action stored by the failed sample was an owner-scoped,
source-linked **suggestion**, not an accepted/open action. That distinction was
verified by a read-only query scoped to `cost-replay-user` before smoke reset.

Repair validation passed: six focused boundary/recovery tests, the unpaid isolated
smoke, all 52 browser contract tests, affected tests, `pnpm verify` including the
production build, and fresh `pnpm coverage:ci` followed by
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`. Coverage included 1,726 agent tests,
2,148 active web tests, 2,392 database tests and 795 domain tests. No audit settings
or outcome assertions were relaxed. Review confirmed the prior tool-loop patch is
unchanged apart from generated patch index metadata.
