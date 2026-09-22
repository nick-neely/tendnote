# Eve deterministic evaluation - 2026-09-22

## Result

**Focused confirmation only: this is not a clean full-suite qualification.**

**PASS - the one selected case passed its first sample.**

| Field | Value |
| --- | --- |
| Source commit | `68569444802c33a1011b865d0809f7435371bb08` |
| Run record | https://github.com/nick-neely/tendnote/issues/579 |
| Trigger | `local` |
| Command | `eve eval policy/phase-seven-no-invented-priority-alert --strict --skip-report --max-concurrency 1 --timeout 180000 --json --junit junit.xml` |
| Execution window | 2026-09-22T15:09:00.792Z–2026-09-22T15:09:29.863Z |
| Agent model | `google/gemini-3.7-flash` |
| Eve version | `0.47.7` |
| Counts | 1 passed, 0 failed, 0 skipped, 0 errored, 1 total |
| Retry status | No retry; first sample only |
| Wrapper exit code | 0 |

Machine-readable details are in `metadata.json`, `junit.xml`, and `raw/`. Verify every preserved file with `sha256sum -c SHA256SUMS`. Run artifacts supplement this repository bundle; they do not replace it.

## Scope and cost

Only `policy/phase-seven-no-invented-priority-alert` ran, on the assertion repair
that distinguishes a clarification question from a completed-action claim.
It passed all assertions, exit 0, with no retry. Six unit regression examples
also pass, including rejection of actual unauthorized-action claims.

This focused run added six requests, $0.05674405 provider charges and $0.00135
reporting-write allowance, totaling $0.05809405. The cumulative ledger includes
both prior complete runs: 897 requests, $7.17983605 provider charges plus
$0.201825 allowance, totaling $7.38166105. No requests remain pending.

Isolation and reservation conditions match the preceding 59/60 full run:
fresh synthetic local database, 180-second timeout, schedules and built-in
provider web search disabled, no external transports. The final candidate has
not had a complete 60-case paid run. Do not combine this result with the
preceding candidate's 59 passes and label that a clean first sample.
