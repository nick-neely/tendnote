# Baseline cost replay harness

Preparation for [Run the approved baseline cost replay](https://github.com/nick-neely/tendnote/issues/578).
The owner authorized building and validating this harness with synthetic data
and unpaid checks, then separately approved one paid replay on 2026-09-18,
capped at $25 total across all three variants with web search excluded.
That attempt stopped during startup before any inference request. No monthly
cost or price is established by that startup failure. Because no inference was
sent, continuation after the startup repair uses the existing approval and the
same unspent $25 allowance. No paid sample or uncertain charge may be retried.

## First paid sample outcome

The [continuation on the repaired source](../../evidence/cost/1b6b9f1adf90815b3df8bc7e1216bc7dc927dd6a/README.md)
ran on 2026-09-19 and stopped during the light workload. All fifteen calls settled
for **$0.142670825**, with no pending requests or reserved dollars. Typical and
heavy did not start, and no monthly cost estimate or variance is available.

The first compound capture followed the current Global Capture route and returned
a Saved Items Note instead of the requested Memory and Follow-Up. The harness's
legacy-tool assertion failed; read-only database inspection independently confirmed
zero Memories and zero Follow-Ups. The fixture and persisted-outcome validation
have since been repaired as described below. The paid sample was not retried. The ticket remains open and cannot yet
supply the pricing or fair-use decisions with usable monthly evidence.

## Repaired paid replay outcome

The owner approved a new run of `capture-contract-v2` on 2026-09-20. Its
[preserved evidence](../../evidence/cost/7569863d880a668061c6148c5bde09abfc3db87e/README.md)
contains a complete light month at **$2.391365985** and a partial typical month
at **$5.061259180 known spend** after 121 of 150 turns. Heavy did not start.
A Gateway transport failure left one extraction request's billing uncertain;
the meter retained **$1.251** and blocked further inference. Known run spend is
**$7.452625165**, or **$8.703625165 including the conservative reservation**.
The reservation is not a confirmed charge. No uncertain request was retried.

The Capture repair passed through the completed light workload and the typical
prefix. This stop was a transport/billing-uncertainty guard, not a failed Capture
outcome or exhaustion of the $25 ceiling. The ticket stays open: typical and heavy
monthly figures are still unavailable, and variance is unmeasured. Any further
paid sample needs an explicit plan and approval after reconciling the uncertainty.

## Reconciliation and transport repair

The owner asked to reconcile and repair the interrupted run on 2026-09-20.
Two read-only [Gateway reporting queries](https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting)
matched all 1,318 settled calls, inference charges, and tokens (including cached
input and reasoning output). The [reconciliation artifact](../../evidence/cost/7569863d880a668061c6148c5bde09abfc3db87e/reconciliation.json)
contains the query filters, response buckets, and checks. Gateway reported exactly
216 typical extraction calls, matching the settled ledger; it showed no additional
billed generation for the uncertain request. Reporting is asynchronous, so this
is a dated observation rather than proof that a delayed charge is impossible.
The original uncertain row and its reservation remain unchanged.

The provider reports also exposed fees omitted from the inference-only ledger:
**$0.27135** for reporting writes. Provider-charged totals are **$2.467865985**
for complete light and **$5.256109180** for partial typical, totaling
**$7.723975165**. The two reconciliation queries have a separate documented
**$0.01** fee allowance. With that allowance and the original uncertain
reservation, conservative accounted spend is **$8.984975165**, still below $25.

The repaired proxy reserves **$0.000225 per request** for one reporting user and
two tags, in addition to token costs. This is an allowance, separately labeled
from confirmed inference costs, and conservatively includes embeddings even
though the observed embedding reports charged no reporting writes. A run-specific
reporting user replaces the shared user without adding another write.

Requests now durably record a local ID, timestamps, attempt count, safe network
error fields, and Gateway request/generation IDs when available. The old log
retained only `fetch failed`, so its exact transport cause is unknown. A bounded
retry handles only definite connection-establishment failures: `ECONNREFUSED`
from `connect`, `EAI_AGAIN` from `getaddrinfo`, or `UND_ERR_CONNECT_TIMEOUT`.
At most three attempts share one reservation and one 180-second deadline.
Ambiguous disconnects, HTTP errors, response-body failures, and other timeouts
still stop inference and retain the reservation. These repairs do not claim to
eliminate all provider or network failures.

The next paid sample remains a separate approved operation, with the $25 ceiling
unchanged. A full baseline still needs complete typical and heavy results; the
light sample already exists. A fresh replay cannot be assumed to fit the cap:
extrapolating the observed typical prefix solely for spend planning suggests a
three-variant replay could exceed $25. That is not a measured heavy-month cost or
a pricing recommendation. The proposed next operation is one fresh, serial
light/typical/heavy replay of the unchanged `capture-contract-v2` workload, web
search excluded, with a **$50 combined ceiling** subject to owner approval.
A simple budget-only extrapolation is about $35, so $50 leaves room for the
full-context reservation and variation. This proposal does not change the live
$25 code bound or authorize spending. No paid inference was made during this repair.

## First approved attempt

The [preserved attempt](../../evidence/cost/1ad0b132b9464aa7e7483a9dbb538b4c67ec6f69/README.md)
reset and seeded the isolated eval database, then failed while Eve loaded model
metadata. No variant started its workload. The ledger contains zero inference
requests, $0 known spend, $0 reserved, and no pending requests. Typical and heavy
monthly costs and sample variance remain unknown; zero spend is a startup result,
not an estimate of product cost.

The proxy forwarded the public catalog's `content-encoding: br` header after
Node fetch had already decompressed its body. Eve's second decompression failed.
The proxy now removes stale encoding and length headers when forwarding decoded
responses. A regression test and an unpaid live catalog fetch verify the repair;
neither sends model inference requests. The original evidence remains unchanged,
and the ticket remains open pending usable monthly evidence.

## Reviewable commands

From the repository root:

```sh
pnpm --filter @tendnote/agent eval:cost --plan
pnpm --filter @tendnote/agent eval:cost --smoke
```

The plan command has no database or network effects. The unpaid smoke test
**resets the local `tendnote_eval` database**, starts a throwaway Eve app, drives
a real session through an artificial Gateway response, and exercises real
Postgres writes, embedding, extraction, evidence storage, and scheduled summary
generation. It never contacts a model provider. Its synthetic token and dollar
figures are visibly marked as simulation and must not enter pricing evidence.

After approval, from a clean committed checkout, with `AI_GATEWAY_API_KEY`
provided through the environment:

```sh
TENDNOTE_COST_APPROVAL=baseline-25-usd pnpm --filter @tendnote/agent eval:cost --paid
```

The approval variable is an operator acknowledgement, not a substitute for
owner approval. The harness does not load a paid key from an environment file,
use ambient OIDC, create keys, buy credits, or rerun a sample automatically.

## Workload hypotheses

The counts are unchanged from the cost-evidence decision:

| Variant | Eve turns | Captures | People | Follow-Ups | Uploads |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light | 40 | 20 | 15 | 10 | 2 |
| Typical | 150 | 80 | 40 | 30 | 8 |
| Heavy | 600 | 300 | 150 | 100 | 30 |

Each variant gets a fresh eval database and one synthetic owner. People are
seeded directly; captures and Follow-Ups go through the real Eve session and
approval protocol. Activity is spread across thirty synthetic days, with a new
conversation each day. Every fourth capture is an explicit confirmed Memory;
the others are casual relationship notes with inline extraction. Remaining
turns are either standalone Follow-Ups or grounded recall. Only confirmed-memory
captures are paired with Follow-Ups; casual notes stay single-purpose. This is the
`capture-contract-v2` fixture revision, not a claim that the failed sample completed.
Approval continuations, model steps, subagents, and retries are additional
billable calls, not additional planned user turns.

Uploads go through the shared evidence-storage entry point. Each is a synthetic
64 KiB PDF attached to a fictional appliance proposal. This is a storage-size
hypothesis, not a measurement of real customer file sizes or an OCR workload.

The synthetic Google Calendar connection uses the existing fake provider
adapter for scheduled workflows. The four workflows run through their product
entry points: thirty Morning Agendas, four Weekly Relationship Reviews, thirty
Post-Meeting Aftercare checks, and thirty Birthday Gift Planning checks.
A workflow that performs no inference contributes zero inference cost; it is
still counted as a check. Reminders have a registered synthetic opt-in but no
push endpoint, so no external notification is sent. There is no real Google
OAuth, provider import, email, Discord, or push delivery in this replay.

Synthetic schedule dates advance; the process clock and database write timestamps
remain real. This is an activity replay, not a time-travel test of cron timing,
cache expiry, retention, or reminder delivery. Storage accounting records
owner-scoped row sizes and exact uploaded bytes; it does not price storage or
allocate shared indexes, infrastructure, and database overhead.

## Capture fixture repair

The original fixture combined a casual narrative, pronouns, numeric names, and an
ISO due date in a compound request. The deterministic Global Capture router fell
back to a Saved Item. Production Capture deliberately recognizes bounded explicit
wording; this repair changes the eval fixture, not that product contract.

The revised fixture uses unique two-word alphabetic names and explicit named
Memory clauses. Paired Memory and Follow-Up clauses are semicolon-separated;
Follow-Ups use a month and day three days after the synthetic activity date.
Those dates resolve against the real process clock, including year rollover.
The synthetic owner uses UTC. Casual captures remain person-linked logged notes,
not confirmed Memories or generic Saved Items.

| Variant | Confirmed captures paired with Follow-Ups | Standalone Follow-Up turns | Recall turns | Casual captures |
| --- | ---: | ---: | ---: | ---: |
| Light | 5 | 5 | 15 | 15 |
| Typical | 20 | 10 | 60 | 60 |
| Heavy | 75 | 25 | 275 | 225 |

Total turns, captures, people, Follow-Ups, and uploads remain unchanged. The
within-turn grouping changed, so a future result measures this revised hypothesis;
it must not be presented as directly comparable to the failed original fixture.
The replay checks new private database records for the intended owner and person,
including approved Memory authority and the Follow-Up date. Old records, a
successful tool name, a generic Note, or a suggested Memory cannot satisfy it.
Partial storage is captured even when a turn fails.

Unpaid routing checks cover every generated explicit request for each variant.
The smoke also exercises the real database-backed Capture entry point for a
grouped Memory plus Follow-Up and a standalone Follow-Up, plus the person-linked
casual capture and extraction path, before checking their stored outcomes. This
validates fixture routing and persistence, not future model reliability. Another
paid sample requires separate approval; the prior paid evidence is unchanged.

## Web-search exclusion

The isolated app disables Eve's provider-executed `web_search` tool, which uses
`gateway.exa_search` and has charges outside the token catalog. The production
app is unchanged. The owner confirmed this exclusion on 2026-09-18. This scope
decision was followed by the separate one-run approval recorded above.
Results measure the synthetic relationship workload, **not** an upper bound on
web-research usage. All authored relationship tools retain their current schemas.
The earlier blanket claim that this is the full current-surface cost ceiling
must be qualified accordingly before using the result to set an offer.

## Spending controls

One **$25 total ceiling covers all three variants combined**, in serial order.
This is deliberately tighter than interpreting the earlier per-run wording as
$25 for each variant. Stopping early produces partial evidence, not permission
to spend another $25. Each source commit can have only one paid output directory;
the runner refuses to overwrite it.

Only the three configured models are accepted: `google/gemini-3.7-flash` for
Eve, snapshots, and summaries; `google/gemini-3.1-flash-lite` for extraction;
`openai/text-embedding-3-small` for embeddings. No model fallback or comparison
is configured. The public Gateway catalog is captured at paid-run start.

A local proxy serializes **individual model requests**, including calls made by
background extraction, embeddings, and subagents. Before forwarding a language
request, it durably reserves twice the catalog's highest input/output rates
across base, regional, and service-tier pricing, multiplied by the model's full
context and output limits. Embedding reservations cover the full 8,192-token
input limit for each bounded batch entry. This intentionally over-reserves
rather than relying on a prompt-length estimate. Actual cost comes from
`providerMetadata.gateway.cost`, not from a token-price estimate.

A request whose full reservation does not fit is refused before forwarding.
Missing prices, unsupported models or provider tools, missing terminal billing,
ambiguous transport failures, or a reported charge exceeding its reservation stop all
further inference. An uncertain request retains its reservation in the ledger.
No retry is allowed after uncertainty. Definite pre-connection failures may use the bounded attempts described above. A large reservation can therefore stop
a run below $25, even if a small actual request might have fit.

The bound depends on the catalog covering the allowed token charges and
providers respecting their context/output limits; it is not a contractual
provider-side billing cap or protection against a provider billing error.
Gateway budgets may be added as a separate provider-side backstop, but are
checked before requests and should not replace in-flight reservations.
See [Gateway budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets),
[model catalog fields](https://vercel.com/docs/ai-gateway/models-and-providers),
and [Gateway generation usage](https://vercel.com/docs/ai-gateway/observability-and-spend/usage).

## Isolation and evidence

The runner copies the current agent and evals into an ignored `.eve/` directory,
without environment files or automatic schedules. It provides a small explicit
child environment, a dummy Gateway key, and a fetch preload that routes Gateway
calls to the metered proxy and refuses other non-loopback fetch destinations.
The real Gateway key stays in the parent process. This is a test harness boundary,
not an OS sandbox. Authored tools and policies remain the current source.

Paid output lives at `evidence/cost/<source-commit>/`. `metadata.json` records
configuration and completion; `catalog.json` captures model pricing;
`ledger.json` holds reservations and content-free token/cost rows; `summary.json`
groups them by variant and category; each variant JSON records progress and
stored activity. Unknown charges are marked uncertain, never treated as zero.
Raw session transcripts remain in the ignored throwaway app, not the published
bundle. Failed or incomplete workload execution returns nonzero and preserves
what completed. A single sample per variant cannot establish variance.

The ticket remains open until an approved paid run has produced usable evidence
or an explicitly accepted partial outcome. Harness readiness is not its resolution.

## Harness validation

The unpaid end-to-end smoke passed against the real Eve and Postgres runtime.
The repaired smoke exercised twelve artificial Gateway requests across interactive, snapshot,
extraction, embedding, and scheduled-summary categories. Artificial costs are
not evidence of the paid service's economics. The focused suite covers budget
reservation, concurrent calls, uncertain billing, model/routing restrictions,
external-fetch blocking, explicit paid opt-in, and child-process cleanup.

Repository verification also required one inherited lint repair: adding an
explicit button type to the existing signup prototype's reset button. No other
prototype behavior changed.

The reconciliation repair adds eleven focused transport/accounting tests; all
34 replay tests pass. The unpaid end-to-end smoke completed twelve artificial
requests with two Memories, two Follow-Ups, no Saved Items, and no unfinished
background jobs. Repository verification exposed an inherited Gmail DOM-test
race: two assertions checked the idle button before React's transition settled.
Those assertions now await the idle label; all thirteen tests in that file pass.
No Gmail product behavior changed.

`pnpm test:affected` passed. `pnpm verify` passed typechecking and lint, then
stopped at the inherited Gmail assertion race above. After its repair, the
focused Gmail suite passed, the full `pnpm coverage:ci` run passed (including
all 2,148 active web tests), and the standalone production build passed.
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` returned no findings. The full
verification command itself was not rerun; its failed test was verified at the
correct seam and all verification lanes completed successfully.
