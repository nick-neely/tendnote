# Cost replay evidence

Source: 1ad0b132b9464aa7e7483a9dbb538b4c67ec6f69

Status: partial. One sample per completed variant; variance is not measured.

Command: `pnpm --filter @tendnote/agent eval:cost --paid`

See metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. Storage bytes are measured, not priced. Raw prompts and replies are omitted.

## Startup failure

Eve exited while loading the public model catalog, before any inference request
or variant workload. The ledger records zero requests, $0 known spend, $0
reserved, and zero pending requests. No variant JSON exists because none began.
There is no monthly cost estimate or measured variance from this attempt.

The metadata proxy sent a decoded body with the upstream Brotli encoding header,
causing Eve's fetch to fail with `terminated` / `Decompression failed`.
The subsequent harness repair removes stale transport headers and is verified by
a regression test and an unpaid fetch of the live catalog through the proxy.
The captured catalog data is unchanged; JSON whitespace was formatted for the
repository's checks. No paid retry was performed as part of this repair.
