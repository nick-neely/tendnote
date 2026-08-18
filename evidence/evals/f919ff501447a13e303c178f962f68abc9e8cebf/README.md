# Eve deterministic evaluation — 2026-08-17

## Result

The manually dispatched pre-publication gate reached the deterministic suite but
was **non-clean**. It is preserved here as an evaluation result, not published
as a Phase 9a case-study claim. No evaluation expectation or product behavior
was changed for this run.

| Field | Value |
| --- | --- |
| Source commit | `f919ff501447a13e303c178f962f68abc9e8cebf` |
| Workflow | [`Run Eve model evaluations` #31996526770](https://github.com/nick-neely/tendnote/actions/runs/31996526770) |
| Trigger | `workflow_dispatch` |
| Command | `pnpm --filter @tendnote/agent eval:deterministic` |
| Execution window | 2026-08-17 05:03:00–05:15:20 UTC (12m 20s) |
| Agent model | `anthropic/claude-haiku-4.5` (the workflow did not override `TENDNOTE_AGENT_MODEL`) |
| Judge model | Not used; this gate runs deterministic cases only |
| Data preparation | A fresh Docker-backed `tendnote_eval` database was reset, migrated, and seeded before the initial sample and each retry |

The first sample graded all 60 deterministic cases: 51 passed and 9 failed.
The retry wrapper resampled those 9 failed cases twice against fresh prepared
databases. It recorded 7 persistent failures, 2 recovered-but-flaky cases, and
0 skipped cases. The wrapper exited 1, as required for a non-clean gate.

### Persistent failures

- `behavior/capture-precedence/0002`
- `behavior/capture-precedence/0003`
- `behavior/draft-revision-lifecycle`
- `behavior/general-action-area-filing`
- `behavior/suggested-memory-proposal`
- `policy/asset-inferred-reminder-timing-boundary`
- `policy/gift-plan-surprise-boundary`

### Recovered but not clean

- `behavior/self-context-direct-write`
- `policy/household-privacy-boundary`

The first two persistent capture-precedence failures also exercised a concrete
store error when the model supplied `"new"` as a person id. The raw reports
below are the authority for detailed failure classification; this task does not
remediate those product or evaluation failures.

## Preserved raw output

The files below are exact copies of the uploaded workflow artifact's top-level
machine-readable reports. `initial` is the full tagged suite; both retries run
the nine initial failures. SHA-256 digests make the copied reports auditable.

| File | SHA-256 |
| --- | --- |
| `junit.xml` | `c33e69743dd81bf13e8f152d72fd67e2e1d13ff293266978a7866d6054f15285` |
| `raw/initial-summary.json` | `e7f52f3170573d6b1bae13d30138609cec719ee0bf5b2909db3844ed0971fe57` |
| `raw/initial-results.jsonl` | `e3f800da9a8ff92c8ad9f42a76d4b316515621afba89c920142ac03342f022f6` |
| `raw/retry-1-summary.json` | `3d9dcec1db571bd09ce2b9e2a1a797d8cc4598dc5c7107ad07874c21725f9350` |
| `raw/retry-1-results.jsonl` | `c098934c1f8e89fbd387d5779cfc495803996625d00b5c12fae268efbe8252c9` |
| `raw/retry-2-summary.json` | `4b263f436dc66a9a88c9475e4657b5b61422e0f212e5f707fad81ff5af079dc5` |
| `raw/retry-2-results.jsonl` | `c861345b60d5d86de70fe5cb126ec5a870933ed3e624ac8bbe2681f189f3eb80` |

The GitHub artifact additionally contains Eve event traces. They remain
available from the linked workflow run; the committed files preserve the JUnit
contract and the raw JSON summaries/results needed to reproduce this gate's
classification without treating retry recovery as a pass.
