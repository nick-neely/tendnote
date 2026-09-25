# Production and Fallback models

Decision artifact for [Choose production and fallback models within the Spend
Breaker budget](https://github.com/nick-neely/tendnote/issues/589). It fixes the
production model, the Fallback Model, the provider path every hosted model call
takes, the evidence that qualifies both models before launch, the budget
arithmetic, and the Spend Breaker's dollar ceiling. It does not build anything
or authorize model spending.

All decisions below were confirmed by the owner in the grilling session of
2026-09-25.

## Sequencing against disclosure

Models are chosen now, as a planning decision, before
[ADR 0227](../adr/0227-eve-interactive-tool-surface-uses-progressive-disclosure.md)
progressive disclosure is built. The choice turns on price and data terms, which
disclosure does not change, and disclosure only lowers per-turn cost.
Qualification is what waits: it runs on the disclosure surface customers will
actually use, as a launch gate during implementation (see
[Qualification](#qualification-a-launch-gate)). This refines the map's
"disclosure precedes model selection" note: disclosure precedes model
*qualification*.

## The models

| Role | Model | Provider (pinned) | Evidence today |
| --- | --- | --- | --- |
| Production (Eve, snapshots, summaries, scheduled) | `google/gemini-3.7-flash` | Vertex | [Baseline cost replay](baseline-cost-replay.md) and a clean 60/60 [deterministic run](deterministic-eval-repair.md) |
| Fallback Model (interactive Eve over its Fair-Use Budget) | `openai/gpt-6-luna` | OpenAI | None; estimate only |
| Extraction and embeddings | Unchanged: `google/gemini-3.1-flash-lite` on Vertex, `openai/text-embedding-3-small` on OpenAI | as listed | Baseline cost replay |

**Production** is pinned to Gemini 3.7 Flash because it is the only model with
evidence. Gemini 3.8 Flash costs the same and is newer, but unqualified. Any
later model swap, including 3.8 or promoting GPT-6 Luna to production, is
treated like a cost-motivated change: it must pass the
[regression bar](cost-and-reliability-evidence.md#regression-bar-for-cost-motivated-changes)
before hosted accounts see it.

**The Fallback Model** is GPT-6 Luna: the cheapest compliant candidate by a
wide margin, from a vendor already on the sub-processor list for embeddings.
The accepted risk is that Eve's prompts and tool schemas were tuned on Gemini,
so a different model family may behave differently; qualification exists to
catch that. If Luna fails qualification, the Fallback Model becomes Gemini 3.1
Flash Lite without a new decision.

Candidates considered, re-priced on the heavy month's actual token mix
(152.6M input tokens, about 91% cache reads, 278k output) at AI Gateway list
prices read on 2026-09-25:

| Candidate | Input / cache read / output per M | Heavy month | Per turn | Outcome |
| --- | --- | ---: | ---: | --- |
| Gemini 3.7 Flash (measured) | $0.75 / $0.075 / $3.75 | $21.44 | $0.036 | Production |
| GPT-6 Luna | $0.10 / $0.01 / $0.50, cache write $0.125 | $2.90 to $4.50 | $0.005 to $0.0075 | Fallback Model |
| GLM 5.3 Flash | $0.15 / $0.03 / $0.50 | $6.31 | $0.011 | Rejected: cache reads cost the same as Flash Lite, so it is barely cheaper; served by many independent hosts, so caching needs a pinned host |
| Gemini 3.1 Flash Lite | $0.25 / $0.03 / $1.50 | $7.92 | $0.013 | Named alternate if Luna fails |
| Claude Haiku 4.5 | $1.00 / $0.10 / $5.00 | higher than production | n/a | Rejected: not cheaper |

The Luna range depends on whether its cache-write charge applies to implicit
caching. Every non-Gemini figure is an estimate: tokenizers differ across
model families, and the call count per turn may change.

## Provider path

Every hosted model call goes through the Vercel AI Gateway on its system
credentials, with the gateway's zero-data-retention and no-training request
flags set on every call and one provider pinned per model, with no cross-host
failover. The gateway then routes only to endpoints it lists as
zero-retention and no-training; each chosen model has such an endpoint on its
pinned provider.

This satisfies the model-provider condition in
[Hosted privacy and customer-lifecycle obligations](hosted-privacy-and-customer-lifecycle-obligations.md).
The owner decided that written confirmation from Vercel and BYOK are not
needed at this scale, which closes the privity question
[the model-terms research](../research/phase-9b-model-provider-data-terms.md)
raised. Today's Gemini Developer API path is retired by the flags, which force
Vertex.

Pinning keeps implicit caching effective and the provider list stable. When a
pinned provider is down, the function shows its existing paused state from
[Bounded usage](bounded-usage-and-support-contract.md).

## Budget arithmetic

The fallback changes how many turns the headroom buys, never the ceiling.

| Interactive Eve | Amount | Turns |
| --- | ---: | --- |
| Fair-Use Budget, full quality on Gemini 3.7 Flash | $10.50 | About 250 published, from the typical month's $0.042 all-in per turn; the heavy month's interactive-only $0.037 would give about 285 |
| Fallback headroom on GPT-6 Luna | $1.50 | Estimated 200 to 300; unpublished until measured |
| Interactive Account Ceiling | $12.00 | Pauses new turns |

The Account Ceiling stays $14.00: $12.00 interactive, $1.30 background, $0.70
web search. Published copy keeps "about 250 full-quality turns", then says Eve
"continues on a lighter model up to the monthly limit" with no number until
qualification measures the fallback's per-turn cost.

The Fallback Model is an account-level switch at the soft budget, not a
Spend Breaker stage. The breaker's shedding order in
[ADR 0246](../adr/0246-hosted-inference-is-metered-content-free-and-shed-in-a-fixed-order.md)
is unchanged.

## Spend Breaker ceiling

The deployment-wide daily ceiling is derived, not fixed:

> daily ceiling = 2 x (admitted accounts x $14.00 / 30) + $5.00

recomputed daily. Per-account ceilings already bound customer spend, so the
breaker only trips when metering has failed: a runaway loop, a metering bug, or
a provider price change. Doubling the combined ceiling pace does that without
tripping on normal growth; the $5.00 covers operator use. At ten admitted
accounts it is about $14 a day.

## Qualification: a launch gate

One separately authorized paid task, run during implementation on the
disclosure surface, under a **$15** cap:

- the policy-tagged Eve evals on Gemini 3.7 Flash and on GPT-6 Luna, once
  each, retries counted and the result preserved, flake included;
- the typical Representative Month replayed on each model, measuring the
  Fallback Model's real per-turn cost and what disclosure actually saves.

Luna is eligible as the Fallback Model only after its policy-tagged run
passes. The full deterministic and judged tags are not on the bar. The measured
fallback cost then sets the published fallback turn count.

This is recorded as a launch gate, not a map ticket, because it needs
disclosure built, which is outside this planning map.

## Limits

- Production evidence covers the deterministic eval scope and one replay
  sample per workload. Schedules, provider web search, external transports,
  and repeated-run reliability remain unqualified, as recorded in the
  [deterministic run](deterministic-eval-repair.md).
- External-integration qualification belongs to launch evidence, not here.
- Prices are gateway list prices on 2026-09-25 and move.

No ADR is recorded: model identity, pinning, and the breaker formula are cheap
to revise, and the hard-to-reverse boundary they sit on is ADR 0246.

## Not decided here

The Usage Ledger schema; the pricing page's exact wording; whether GPT-6 Luna
should later become the production model, which qualification evidence may
inform.
