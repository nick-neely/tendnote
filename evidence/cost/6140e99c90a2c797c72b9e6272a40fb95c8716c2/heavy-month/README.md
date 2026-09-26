# Cost replay evidence

Source: 6140e99c90a2c797c72b9e6272a40fb95c8716c2

Status: partial. One 30-day sample per selected variant; variance is not measured.

Command: `pnpm --filter @tendnote/agent eval:cost --heavy`

See metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. knownSpendUsd records response-reported inference cost; reportingWriteUsd is a conservative reporting-fee allowance, not a confirmed charge. accountedSpendUsd includes both plus unsettled reservations. Reconcile provider reporting before treating these as total charged cost. Storage bytes are measured, not priced. Raw prompts and replies are omitted.

## Failure investigation and recovered checkpoint

Validated 240/600 turns, through day 12. Day 13's first accepted message failed
while opening its stream: `Session not found.` Eve hides every stream-open
exception behind that response. The persisted session exists and reads in a fresh
process; creation-to-first-event took about 71 seconds. The exact discarded
exception is unknown. This is distinct from the previous signal interruption.

All 1,933 requests settled: inference $9.217824220 plus conservative reporting
allowance $0.434925, totaling $9.652749220 before the single query allowance.
No provider report query has been made for this attempt yet. These numbers are
response-reported inference and reserved reporting allowances, not a final
provider-bill reconciliation. All costs carry forward if this run resumes.

`recovery.json` records a checked day-12 checkpoint, with 240 validated turns.
Turn 241 is not promoted to validated. Read-only inspection of its 11 persisted
events found only a skill-loading action. The live database subsequently had no
unfinished background jobs and matched the completed source/follow-up/upload
counts. Ancillary records from the failed attempt remain as explicit overhead.
The raw metadata, progress and ledger values remain preserved; JSON formatting
follows repository conventions. The private database snapshot is not committed.

See the [checkpoint and resume instructions](../../../../docs/phase-9b/heavy-replay-preflight.md).
