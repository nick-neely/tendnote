# Cost replay evidence

Source: f89de979b48aea9cb5efc07dd0a75f97a9cca325

Status: partial. One 30-day sample per selected variant; variance is not measured.

Command: `pnpm --filter @tendnote/agent eval:cost --heavy --resume /home/exedev/dev/tendnote/apps/agent/.eve/replay-checkpoints/f8936abe-54ac-4261-b1c0-7529d08f0978`

See metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. knownSpendUsd records response-reported inference cost; reportingWriteUsd is a conservative reporting-fee allowance, not a confirmed charge. accountedSpendUsd includes both plus unsettled reservations. Reconcile provider reporting before treating these as total charged cost. Storage bytes are measured, not priced. Raw prompts and replies are omitted.
