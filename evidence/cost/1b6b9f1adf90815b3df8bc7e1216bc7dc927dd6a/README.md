# Cost replay evidence

Source: 1b6b9f1adf90815b3df8bc7e1216bc7dc927dd6a

Status: partial. One sample per completed variant; variance is not measured.

Command: `pnpm --filter @tendnote/agent eval:cost --paid`

See metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. Storage bytes are measured, not priced. Raw prompts and replies are omitted.

## Result: incomplete light sample

Owner authorization: one replay, $25 total across all variants, with web search
excluded. A prior startup at source `1ad0b132` sent no inference requests; this
continuation ran after the catalog proxy repair under the same allowance.

The light sample stopped after one successful recall turn and three scheduled
checks, on its first capture-and-follow-up turn. Typical and heavy did not run.
All 15 inference requests settled for **$0.142670825 total**. There are no pending
requests, uncertain costs, or retained reservations. No paid sample was retried.

| Category | Calls | Input tokens | Output tokens | Cost USD |
| --- | ---: | ---: | ---: | ---: |
| Interactive | 9 | 383501 | 2113 | 0.135688575 |
| Snapshot | 3 | 787 | 950 | 0.004152750 |
| Extraction | 2 | 686 | 48 | 0.000243500 |
| Scheduled | 1 | 53 | 679 | 0.002586000 |
| Total | 15 | 385027 | 3790 | 0.142670825 |

No embedding request occurred. These totals include the failed workload turn;
`light.json` counts only fully validated workload turns, so its one-turn count
must not be used as a cost-per-turn denominator.

### Why it stopped

The harness expected `capture_memory` and `create_followup`. Current agent
instructions instead require `capture_saved_item` for a compound save request.
Eve followed that route, but its confirmation was a Saved Items Note. A read-only
post-stop database check found one Saved Item and one Source Record, with zero
Memories and zero Follow-Ups. Merely accepting the alternate tool name would
therefore hide missing workload outcomes. `diagnosis.json` preserves content-free
tool names and the returned destination; raw prompts and replies remain local.

`post-stop-storage.json` records the read-only storage measurement after failure:
13,717 logical owner-scoped row bytes, no uploaded evidence bytes, and zero
unfinished background jobs. This includes seeded fixture records and the partial
activity. It is not a complete month's storage measurement or a priced cost.

### Consequence and next step

No light, typical, or heavy monthly estimate is available; variance is unmeasured.
This partial sample cannot set price or fair-use limits. The replay ticket stays
open, and pricing remains blocked on usable evidence.

Before another paid sample, align the compound capture fixture and its validation
with the current Global Capture contract. Reproduce the missing Memory and
Follow-Up through the deterministic capture entry point with unpaid tests, then
validate persisted outcomes rather than requiring legacy tool names. Preserve
this failure in comparisons; do not relax the expected workload to accept a Note.
A further paid sample requires approval under the no-automatic-rerun agreement.
