# Eve deterministic evaluation - 2026-09-22

## Result

**CLEAN - every selected case passed its first sample.**

| Field | Value |
| --- | --- |
| Source commit | `3c8e8eebc03f9389562d7694090949ae00e55f75` |
| Run record | https://github.com/nick-neely/tendnote/issues/579 |
| Trigger | `local` |
| Command | `eve eval --tag deterministic --strict --skip-report --max-concurrency 1 --timeout 180000 --json --junit junit.xml` |
| Execution window | 2026-09-22T15:15:22.675Z–2026-09-22T15:43:04.974Z |
| Agent model | `google/gemini-3.7-flash` |
| Eve version | `0.47.7` |
| Counts | 60 passed, 0 failed, 0 skipped, 0 errored, 60 total |
| Retry status | No retry; first sample only |
| Wrapper exit code | 0 |

Machine-readable details are in `metadata.json`, `junit.xml`, and `raw/`. Verify every preserved file with `sha256sum -c SHA256SUMS`. Run artifacts supplement this repository bundle; they do not replace it.

## Local run conditions and qualification scope

This is a new, complete run of all 60 deterministic cases on the final repaired
candidate, authorized after the preceding session. Every case passed on its
first sample, with no evaluation retries, skips, or errors; the process exited
0. The report window was 27 minutes 42 seconds. The packager reconciled the
summary, JSONL verdicts, JUnit case IDs, and observed model/runtime identity.

The run used Gemini 3.7 Flash and patched Eve 0.47.7, a freshly reset and seeded
synthetic local `tendnote_eval`, serial execution, and a 180-second case timeout.
Schedules and built-in provider web search were disabled, matching the preceding
cost-controlled runs. Authored tools were unchanged. External transports were
unavailable. This is clean local deterministic evidence, not qualification of
live web search, external integrations, production, or repeated-run reliability.

The ledger carries forward the preceding 897 requests and $7.38166105 total.
This run added 452 requests: $3.597059105 in provider charges plus $0.1017 in
reporting-write allowance, totaling $3.698759105. All 1349 cumulative requests
settled, for $11.080420155 including allowance. The owner authorized this new
run; the proxy allowed $6 additional spend, a cumulative ceiling of $13.38166105.
Input reservations used twice the serialized UTF-8 request bytes plus 8192
tokens, capped at the model context window, with doubled maximum catalog rates
and the full output window reserved. Provider-native tools remained denied.

The earlier 53/60 and 59/60 complete runs and the 1/1 focused confirmation are
preserved separately in the [repair report](../../../docs/phase-9b/deterministic-eval-repair.md).
Their verdicts have not been rewritten or combined into this result.

The candidate's harness repairs passed `pnpm verify`, `pnpm coverage:ci`, and
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`. PR confirmation checks for
Database, Instant matrix, Quality, and Test and Fallow also passed before this
run. This run changed no authored source; only evidence and planning records
are added afterward.

## Meter shutdown reconciliation

`raw/proxy-ledger.json` preserves the proxy's last on-disk callback unchanged.
Its pending-request count was captured before the final request's cleanup.
`meter-final.json` preserves the final shutdown snapshot emitted by the runner:
zero pending requests, zero reservations, and the same 1349 rows and charges.
`ledger.json` combines those final counters with the original rows. No billing
amount or request row was changed.
