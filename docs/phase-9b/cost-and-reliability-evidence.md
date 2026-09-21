# Cost and reliability evidence for a paid offer

Decision artifact for [Define the cost and reliability evidence needed for a
paid offer](https://github.com/nick-neely/tendnote/issues/568). It fixes what
per-user cost means for hosted Tendnote, how it is measured, what reliability
the author-operated service commits to, how usage is bounded so no account is
loss-making, what happens when a budget runs out, and what evidence a
cost-motivated change must show before it reaches a paying account. It also
specifies the first cost-bounded evaluation plan, which is approved and run
separately. It does not run any paid evaluation, set a price, choose a
production model, or write the support contract; those remain with their own
tickets, listed at the end.

## Facts this decision rests on

- The interactive agent, snapshot generation, extraction, and embeddings each
  have their own configured model. The agent defaults to
  `google/gemini-3.7-flash` through the Vercel AI Gateway, extraction to
  `google/gemini-3.1-flash-lite`, and embeddings to
  `openai/text-embedding-3-small` (`apps/agent/agent/agent.ts`,
  `apps/web/.env.example`).
- No per-account token or spend accounting exists. Provenance fields record
  which model produced an output, not what it cost. The gateway's spend logs
  are keyed by request, not by Tendnote account.
- The tool-surface reduction in
  [ADR 0227](../adr/0227-eve-interactive-tool-surface-uses-progressive-disclosure.md)
  is recorded but not built. Every interactive turn still ships all authored
  tool schemas, measured there at roughly 17.7k fixed input tokens per turn.
- The deterministic Eve eval suite has executed. The preserved bundles under
  `evidence/evals/` are non-clean, and the owner reports a clean local run that
  failed in GitHub Actions on flake. Runs cost real money and vary between
  samples, so the suite is treated as evidence with variance, not as a
  deterministic gate.
- Product rate limits already exist per cost category and per minute:
  `eve-ingress`, `llm-extraction`, `embedding`, `provider-call`, and
  `push-delivery` among them (`packages/rate-limit/src/index.ts`,
  [ADR 0070](../adr/0070-product-rate-limits-are-separate-from-auth-limits.md)).
  Nothing bounds a month.
- Background work is Postgres-owned and delivered through Vercel Queues with a
  ten-minute recovery cron; reminder push is its own topic and never depends on
  an extraction job ([Background Job Delivery](../background-job-delivery.md)).
- Asset evidence files are stored as bytes in Postgres, so storage cost scales
  with the account rather than with an object store
  (`packages/db/src/schema/app/asset-evidence.ts`).
- Household Guests consume no inference and do not enter the cost model
  ([Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)).
- The owner's binding constraint: hosted Tendnote is not externally funded, so
  no admitted account may cost more to serve than it pays.

## What measured cost means

Per-user cost is the variable cost of one account for one month: model spend
across every cost category plus stored bytes. Fixed infrastructure (Vercel,
Neon, Redis, Resend, Web Push) is allocated across a stated account count in
the pricing ticket rather than attributed per account.

The priced unit is the **Representative Month**: a synthetic month of Launch
Customer activity built from the First Value loop plus the Return, replayed
through Eve's real session protocol against the eval database, with gateway
spend read per run. Three variants exist, and each has a job:

| Variant | Eve turns | Captures | People | Follow-Ups | Evidence uploads | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Light | 40 | 20 | 15 | 10 | 2 | The floor |
| Typical | 150 | 80 | 40 | 30 | 8 | The cost basis for price |
| Heavy | 600 | 300 | 150 | 100 | 30 | Sets the fair-use ceiling |

Every variant has one Google connection, reminders opted in, and the four
scheduled workflows on, so background and scheduled inference is counted, not
just interactive turns. These sizes are starting hypotheses. They are revised
after the first month the Usage Ledger observes real accounts.

## The Usage Ledger

Production is checked against the Representative Month by a **Usage Ledger**:
a content-free, per-account daily rollup of model id, cost category, input and
output tokens, call count, and stored bytes. It never records prompts, replies,
record identifiers, or which person or Memory a call touched, mirroring
[ADR 0242](../adr/0242-activation-milestones-are-content-free-and-product-owned.md).
It is retained thirteen months so one year of an account can be compared with
the same month a year earlier.

The ledger is a launch requirement, not a price prerequisite. The replay
produces the price basis; the ledger exists before the first paying customer so
a real account diverging from the workload is seen rather than guessed.

## Sequencing against disclosure and the eval gate

Cost is measured now, on the current tool surface and the current default
model, and the figure is a ceiling. ADR 0227's disclosure work and a preserved
clean deterministic run remain prerequisites for the model-selection decision,
not for having a cost number. The reduction and any cheaper model only lower
the ceiling; a price set against it cannot be undercut by them.

## Profitability rule and fair use

The **Fair-Use Budget** is a per-account monthly allowance per cost category.
[The paid offer and price](paid-offer-and-price.md) sets it where full quality
ends, about 1.65 times the typical variant, rather than where the heavy variant
is still profitable; the heavy variant exceeds it by design. No admitted
account is loss-making because the hard Account Ceiling, derived from the
lowest effective monthly revenue, holds above it. The budget is soft: crossing it changes pace and model, never
access, and never authority.

An account over its budget sees a visible notice in the Eve composer and on
Today, and its interactive turns run on a cheaper **Fallback Model** until the
period resets. The fallback is never silent, and it must have passed the
policy-tagged evals at least once locally before it is eligible. Extraction
and embeddings over budget defer in their normal pending state. Reminders are
unaffected by any budget.

## Exhaustion: the Spend Breaker

A deployment-wide daily spend ceiling protects the author against a bad day,
whether from abuse, a runaway loop, or a provider price change. When crossed,
the **Spend Breaker** sheds work in a fixed order:

1. Background extraction and embeddings pause and stay pending for recovery.
2. Scheduled workflows (briefs, reviews, agenda, aftercare) skip their next
   delivery with a notice.
3. Interactive Eve refuses new turns with a notice, last.

Reminder delivery is never shed. It is the promise; inference is the cost.
The breaker is a pace control and runs beside ADR 0128's mode gate, never
inside it: nothing about shedding grants or withholds a capability.

## Reliability commitment

The service is operated by one person with no on-call. It makes one public
promise: a support reply within two US business days by email. Everything else
is an internal **Reliability Indicator** with a provisional target, recorded as
a hypothesis until measured:

| Indicator | Provisional target | Why it is the one that matters |
| --- | --- | --- |
| First Value path availability | Synthetic check of landing, checkout, admission, and a grounded Eve answer every ten minutes | A newcomer who cannot reach First Value is a refund |
| Reminder delivery lateness | Delivered within five minutes of the alert time | A late reminder is a broken promise, not a slow page |
| Background job backlog age | Oldest pending delivery under thirty minutes | Extraction lag is where a captured Memory silently fails to appear |

Targets are revised after the first measured month. No uptime percentage is
promised publicly.

## Regression bar for cost-motivated changes

A change made to save money (disclosure, a model swap, a fallback model, a
throttle) must show, before hosted accounts see it:

- the deterministic Vitest policy tests green in CI on the changed source, and
- one local run of the policy-tagged Eve evals on the changed source, with
  retries counted and the result preserved, flake included.

The judged tag and the full deterministic tag are not on the bar. They are
costly and vary, and the owner has chosen not to load-bear on them. A throttle
may alter pace or model; it may never alter tool authority, approval gates, or
egress rules.

## The first evaluation plan

Approved and run separately, per run, by the owner. This ticket only specifies
it.

- **Purpose:** the cost ceiling for the typical and heavy Representative
  Months on the current surface, and the light floor.
- **Model:** `google/gemini-3.7-flash` for the agent, the configured defaults
  for extraction and embeddings. No candidate comparison in this plan.
- **Method:** replay each variant once through Eve's session protocol against
  a fresh `tendnote_eval` database, serially, reading gateway spend per variant
  and recording input and output tokens per cost category.
- **Ceiling:** twenty-five US dollars per run. Abort at the ceiling and
  preserve the partial result.
- **Output:** a bundle under `evidence/cost/<source-commit>/` with the command,
  configuration, per-variant token and spend tables, and a README, in the
  shape of the existing eval bundles.
- **Consumers:** the pricing ticket reads the typical figure; the usage ticket
  reads the heavy figure to set the Fair-Use Budget.

A second plan, comparing candidate models, is written only after disclosure is
built and a clean deterministic run is preserved.

## Glossary

`CONTEXT.md` gains Representative Month, Usage Ledger, Fair-Use Budget, Spend
Breaker, and Fallback Model.
[ADR 0246](../adr/0246-hosted-inference-is-metered-content-free-and-shed-in-a-fixed-order.md)
records the ledger boundary, the shedding order, and that throttling changes
pace and never authority.

## Hand-offs

- [Define bounded usage and the author-operated support contract](https://github.com/nick-neely/tendnote/issues/571):
  the Fair-Use Budget numbers from the heavy variant, the over-budget notice
  copy, and the two-business-day email promise.
- [Decide the paid offer and price from measured evidence](https://github.com/nick-neely/tendnote/issues/573):
  the typical figure as the cost basis, the margin, and the account count that
  allocates fixed infrastructure.
- [Decide the hosted privacy and customer-lifecycle obligations](https://github.com/nick-neely/tendnote/issues/570):
  the Usage Ledger needs disclosure as operator-held metadata.
- [Define the complete marketing-site and demo experience](https://github.com/nick-neely/tendnote/issues/572):
  the support promise and fair-use wording; no uptime claim.
- Run the approved baseline cost replay: a task ticket, blocking the pricing
  ticket.
- Package the clean local deterministic run as evidence: a task ticket, so
  ADR 0227 and the case study cite a preserved artifact.

## Not decided here

The price, the margin, the Fair-Use Budget numbers, the fallback model's
identity, the production model, the breaker's dollar ceiling, the support
contract wording, and the Usage Ledger schema.
