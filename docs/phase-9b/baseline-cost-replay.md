# Baseline cost replay harness

Preparation for [Run the approved baseline cost replay](https://github.com/nick-neely/tendnote/issues/578).
The owner authorized building and validating this harness with synthetic data
and unpaid checks, then separately approved one paid replay on 2026-09-18,
capped at $25 total across all three variants with web search excluded.
That attempt stopped during startup before any inference request. No monthly
cost or price is established by that startup failure. Because no inference was
sent, continuation after the startup repair uses the existing approval and the
same unspent $25 allowance. No paid sample or uncertain charge may be retried.

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
turns ask for grounded recall. Follow-Ups accompany the first eligible captures.
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
transport failures, or a reported charge exceeding its reservation stop all
further inference. An uncertain request retains its reservation in the ledger.
No retry is allowed after uncertainty. A large reservation can therefore stop
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
It exercised seven artificial Gateway requests across interactive, snapshot,
extraction, embedding, and scheduled-summary categories. Artificial costs are
not evidence of the paid service's economics. The focused suite covers budget
reservation, concurrent calls, uncertain billing, model/routing restrictions,
external-fetch blocking, explicit paid opt-in, and child-process cleanup.

Repository verification also required one inherited lint repair: adding an
explicit button type to the existing signup prototype's reset button. No other
prototype behavior changed.
