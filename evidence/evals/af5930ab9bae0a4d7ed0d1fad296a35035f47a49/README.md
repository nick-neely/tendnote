# Eve deterministic evaluation - 2026-09-22

## Result

**BLOCKED - this run is not clean publication evidence.**

| Field | Value |
| --- | --- |
| Source commit | `af5930ab9bae0a4d7ed0d1fad296a35035f47a49` |
| Run record | https://github.com/nick-neely/tendnote/issues/579 |
| Trigger | `local` |
| Command | `eve eval --tag deterministic --strict --skip-report --max-concurrency 1 --json --junit junit.xml` |
| Execution window | 2026-09-22T13:42:48.102Z–2026-09-22T14:12:25.287Z |
| Agent model | `google/gemini-3.7-flash` |
| Eve version | `0.47.7` |
| Counts | 53 passed, 7 failed, 0 skipped, 3 errored, 60 total |
| Retry status | No retry; first sample only |
| Wrapper exit code | 1 |

Machine-readable details are in `metadata.json`, `junit.xml`, and `raw/`. Verify every preserved file with `sha256sum -c SHA256SUMS`. Run artifacts supplement this repository bundle; they do not replace it.

## Local run conditions and failure classification

Fresh local synthetic `tendnote_eval`, serial Gemini 3.7 Flash on patched Eve
0.47.7. Schedules and built-in provider web search were disabled, matching the
cost replay isolation; every deterministic case was selected. The runner used
the existing cost proxy with a $10 ceiling. Provider charges were $3.557674855
plus $0.1017 in reserved reporting-write fees ($3.659374855 total). All 452
requests settled. No paid evaluation retries were performed.

Four failures were approval-scope false negatives: draft revision, follow-up
lifecycle, explicit Action mutation, and Saved Item listing. Their returned
response scope contained tool results but lost the input-bearing requests from
before owner approval. The complete session traces show the actions happened.
Three other cases hit the 60-second local timeout: external-action boundary,
General Action planning, and external-send refusal. Eve counts these three
errors within its seven failed cases, not as three additional cases.

This run remains non-clean evidence. The subsequent repair uses immutable
session assertion checkpoints and a longer explicit local timeout. Two earlier
bootstrap attempts were unbilled: the proxy rejected Eve's built-in provider
web tool before inference, including a simulated diagnostic smoke.
