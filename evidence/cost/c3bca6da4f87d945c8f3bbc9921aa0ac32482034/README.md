# Approved $50 replay: partial outcome

Source: `c3bca6da4f87d945c8f3bbc9921aa0ac32482034`
Run: `4dc43508-eb0b-4753-ab76-5f38095c1024`
UTC: 2026-09-20 02:12:40 to 03:38:23

Light and typical completed. Heavy failed its capture assertion on attempted
turn 30, after 29 validated turns. This is not a complete three-variant baseline.
The owner approved one new combined run capped at $50, with web search excluded.
No automatic paid restart was performed.

| Variant | Validated turns | Inference USD | Provider charged USD | Logical row bytes | Uploaded bytes (included) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light, complete | 40/40 | 2.37888235 | 2.45785735 | 416173 | 131072 |
| Typical, complete | 150/150 | 6.10742800 | 6.35447800 | 1294007 | 524288 |
| Heavy, partial | 29/600 | 1.04577247 | 1.09459747 | 266873 | 65536 |

Both complete variants passed all 94 scheduled checks. Light completed 20
captures, 10 Follow-Ups and two uploads; typical completed 80 captures, 30
Follow-Ups and eight uploads. Heavy completed 14 captures, 19 Follow-Ups,
one upload and three scheduled checks. All three stored zero Saved Items and
had zero unfinished background jobs at collection. Memory counts include
extraction suggestions and are not all approved Memories.

## Charges reconciled

All 1,822 requests settled. Nine model/variant buckets match provider reporting
on request counts, input tokens (including cached input), output tokens
(including reasoning), and inference cost. Decimal cost comparison permits
only 1e-12 USD of serialization roundoff; token and request counts match exactly.
There are no uncertain requests, retained reservations or transport retries.

Provider-reported inference is **$9.53208282**; reporting writes add **$0.37485**,
for **$9.90693282** charged. Three read-only reconciliation queries add a
**$0.015 query-fee allowance**, giving **$9.92193282** including that allowance.
The conservative ledger allowance is $0.40995 because it also reserves reporting
fees for embeddings, which this report does not charge. The allowance is not
an additional charge to add to provider totals.

See [reconciliation.json](reconciliation.json) for the three provider responses
and per-bucket checks. Queries use the run-specific user and variant tags.
[Gateway custom reporting](https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting)
documents the reporting interface and query fees.

## Why heavy stopped

The database assertion was `Expected one new private person-linked source record`.
In the failing session, Eve looked up the explicitly named person and received
one match. It then asked for confirmation again instead of calling
`capture_source_record`. Source count stayed at 14 rather than increasing to 15.
It did not falsely claim the note was saved.

The runtime logged an empty-response recovery in this same turn. Installed Eve
0.47.7 tells the model to answer from the tool results and not re-run tools during
that recovery. This may discourage a still-needed capture after lookup, but
causality is not proven and no repair has been validated. A controlled recovery
reproduction is the next diagnostic step; weakening the capture assertion or
silently repeating a paid month would not establish a fix.

[validation.json](validation.json) records content-free observations and the
failing session/turn identifiers. The aggregate eval `finalMessage` belonged to
an earlier session and must not be used to diagnose this failure. The metadata
SIGTERM is subprocess cleanup after the failed eval, not the underlying failure.

## Interpretation and evidence

This provides the first complete typical sample for this replay effort. Each
completed variant represents one synthetic 30-day workload, not measured
customer behavior; no variance estimate is available. Heavy remains incomplete
and must not be extrapolated into a monthly cost estimate.

Web search, external delivery and allocated infrastructure costs are excluded.
Storage is measured but not priced. Uploaded bytes are already included in
logical row bytes, so these columns must not be added together. Model recovery
calls and approval continuations are included in cost but do not count as
additional planned turns.

Command: `pnpm --filter @tendnote/agent eval:cost --paid`.
`metadata.json` records configuration, `catalog.json` captures catalog pricing,
`ledger.json` records request reservations and settlements, `summary.json`
groups inference and conservative fee allowances by category, and variant JSON
files record activity and storage. Summary row `incomplete: false` means billing
settled, not that the heavy workload completed. Raw prompts, replies and model
traces remain in the ignored isolated workspace and are not published.
