# Eve deterministic evaluation - 2026-09-22

## Result

**BLOCKED - this run is not clean publication evidence.**

| Field | Value |
| --- | --- |
| Source commit | `07d98cdf54d6c1658eec0a7e842568684632a0cc` |
| Run record | https://github.com/nick-neely/tendnote/issues/579 |
| Trigger | `local` |
| Command | `eve eval --tag deterministic --strict --skip-report --max-concurrency 1 --timeout 180000 --json --junit junit.xml` |
| Execution window | 2026-09-22T14:32:37.764Z–2026-09-22T15:01:42.872Z |
| Agent model | `google/gemini-3.7-flash` |
| Eve version | `0.47.7` |
| Counts | 59 passed, 1 failed, 0 skipped, 0 errored, 60 total |
| Retry status | No retry; first sample only |
| Wrapper exit code | 1 |

Machine-readable details are in `metadata.json`, `junit.xml`, and `raw/`. Verify every preserved file with `sha256sum -c SHA256SUMS`. Run artifacts supplement this repository bundle; they do not replace it.

## Local conditions and remaining false positive

This is the second complete local pass, on the approval-scope repair candidate.
All seven failures from the preceding pass passed. There were no timeouts,
skips, or in-run retries. The one failure was the no-invented-priority-alert
assertion matching `I set the alert` inside the safe clarification question
`what time should I set the alert for?`. Tool boundary assertions passed.
The recorded first-sample verdict remains 59/60, not clean.

The run used a fresh synthetic local database, serial execution, and a
180-second case timeout. Schedules and built-in provider web search were
disabled; authored tools were unchanged and all 60 deterministic cases ran.
This does not qualify live web search, external transports, or production.

The cumulative ledger includes the previous run's first 452 requests.
This pass added 439 requests, $3.565417145 provider charges and $0.098775
reporting-write allowance, totaling $3.664192145. Both full passes total
$7.323567 including that allowance; all requests settled.

The same $10 cumulative proxy cap carried forward prior charges. For this
text-only run, reservations used twice the serialized UTF-8 request bytes
plus 8192 tokens (capped at the model window), doubled maximum catalog rates,
and the complete output window, rather than reserving a million-token input
for every short request. Provider-native tools remained denied by the proxy.

Validation before this pass: `pnpm verify`, `pnpm coverage:ci`, and
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` passed. Four original failure
traces also passed unpaid replay through the corrected approval scopes.
