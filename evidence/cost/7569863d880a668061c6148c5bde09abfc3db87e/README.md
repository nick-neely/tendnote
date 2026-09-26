# Cost replay evidence

Source: 7569863d880a668061c6148c5bde09abfc3db87e

Status: partial. One sample per completed variant; variance is not measured.

Command: `pnpm --filter @tendnote/agent eval:cost --paid`

See metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. Storage bytes are measured, not priced. Raw prompts and replies are omitted.

## Approved replay result, 2026-09-20

The owner approved one new `capture-contract-v2` replay under a $25 total cap,
with web search excluded. The prior failed samples remain separate. This run
completed light and stopped during typical after a Gateway transport failure on
an extraction request. Heavy did not start. No paid sample was rerun.

| Variant | Result | Completed turns | Settled calls | Known inference USD | Retained reservation USD |
| --- | --- | ---: | ---: | ---: | ---: |
| Light | Complete | 40 / 40 | 369 | 2.391365985 | 0 |
| Typical | Partial | 121 / 150 | 949 | 5.061259180 | 1.251 |
| Heavy | Not started | 0 / 600 | 0 | Not measured | 0 |
| Run total | Partial | 161 | 1318 | 7.452625165 | 1.251 |

One additional typical extraction request has uncertain billing. Its $1.251
reservation is **not a confirmed charge**. Known spend plus that conservative
reservation is $8.703625165, below the approved cap. There are no pending requests;
the reservation remains because no terminal usage/cost response was received.
Typical's token totals omit that unknown request, and are not complete totals.

### Token and spend table

| Variant | Category | Requests | Known input tokens | Known output tokens | Known USD |
| --- | --- | ---: | ---: | ---: | ---: |
| Light | Interactive | 191 | 8241595 | 36781 | 2.218431825 |
| Light | Snapshot | 45 | 10374 | 17297 | 0.072644250 |
| Light | Extraction | 70 | 20020 | 2649 | 0.008978500 |
| Light | Embedding | 29 | 733 | 0 | 0.000014660 |
| Light | Scheduled | 34 | 3224 | 23701 | 0.091296750 |
| Typical | Interactive | 534 | 25179000 | 87420 | 4.814412750 |
| Typical | Snapshot | 62 | 18894 | 25328 | 0.109150500 |
| Typical | Extraction | 217, including 1 uncertain | 61982 | 7433 | 0.026645000 |
| Typical | Embedding | 83 | 2134 | 0 | 0.000042680 |
| Typical | Scheduled | 54 | 7926 | 28017 | 0.111008250 |

Costs are Gateway-reported charges, not input-token totals multiplied by list
prices. Automatic prompt caching and metered intra-turn retries are reflected in
those charges. A logical user turn can produce several requests, including
approval continuations and background work. Category attribution follows the
proxy rules documented in the harness; totals include all settled requests.

### Workload and storage validation

Light completed 40 turns, 20 captures, 10 Follow-Ups, 2 uploads, and all 94
scheduled checks. Its database had 15 seeded people, 20 Source Records, 10
Follow-Ups, no Saved Items, and zero unfinished background jobs. Per-turn checks
verified the required approved Memories and casual capture authority. Its seven
Memory rows include suggested records; that raw table count is not seven approved
Memories. Storage measured 418,451 logical owner-scoped row bytes and 131,072
uploaded evidence bytes, with uploaded bytes reported separately. Storage is not
priced, and these counters must not be added as a disjoint total.

Typical stopped with 64 validated captures, 26 Follow-Ups, 6 uploads, and 75
scheduled checks. Its partial storage measurement is 999,227 logical owner-scoped
row bytes and 393,216 uploaded bytes, with one unfinished background job. The
completed-turn count includes the last turn before its post-turn meter check
failed. No full typical-month estimate can be inferred from this prefix.

### Stop and limitations

The proxy reported `fetch failed` on `google/gemini-3.1-flash-lite` extraction,
retained the reservation, and rejected further inference. The eval failed with
`Meter stopped or unsettled`. The runner's generic subprocess `SIGTERM` failure
records child cleanup after the failed eval artifact, not evidence of a manual
abort or budget exhaustion. The transport failure does not establish whether the
provider billed that request. `validation.json` reconciles all known totals and
records the uncertainty explicitly.

Eve also emitted empty-response retry and stream-listener warnings while work
continued. Their settled requests remain included. This is cost evidence and
workload validation, not a comprehensive reliability or semantic-quality result.

The completed light sample supplies one synthetic light-month inference figure.
Variance is unmeasured. Typical remains incomplete and heavy is unmeasured, so
this run does not yet supply the required pricing or fair-use figures. Web search,
external delivery, priced storage, and allocated infrastructure remain excluded.
The repaired fixture uses explicit supported wording; it does not establish
reliability for arbitrary natural-language captures.

Before another paid sample, reconcile the uncertain request against Gateway usage
and choose an explicitly approved continuation or rerun plan that preserves these
results. No retries were made after billing became uncertain. The replay ticket
remains open; the map receives no resolution entry yet.

The captured JSON data is unchanged apart from repository formatting. Raw prompts
and replies remain in the ignored local Eve workspace, not this bundle.

## Reconciliation, 2026-09-20

See [reconciliation.json](reconciliation.json) for the two read-only Gateway
reporting queries and reconciled totals. All 1,318 settled generations match the
provider report in count, inference cost, and token usage when cache and reasoning
components are included. The report shows no additional billed generation for
the uncertain extraction request. The original ledger is unchanged; asynchronous
reporting means this observation does not rule out a delayed charge.

Provider-charged cost includes reporting-write fees omitted from the earlier
inference-only totals: **$2.467865985 light**, **$5.256109180 partial typical**,
and **$7.723975165 combined**, including **$0.27135** in reporting writes.
The two reporting queries add a separate documented **$0.01 allowance**.
Conservative accounting including that allowance and the original $1.251
reservation is **$8.984975165**. Typical remains partial and heavy unmeasured.

No inference was retried during reconciliation. The next harness revision adds
reporting-fee reservations, run-specific attribution, content-free diagnostics,
and bounded retries only for proven connection-establishment failures. The exact
old transport cause cannot be determined from the original `fetch failed` log.
