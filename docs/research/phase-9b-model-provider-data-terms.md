# Model-provider training and retention terms behind the AI SDK gateway

Researched 2026-09-16 UTC from public primary sources for [Research
model-provider training and retention terms behind the AI SDK
gateway](https://github.com/nick-neely/tendnote/issues/581). The bar comes from
[Decide the hosted privacy and customer-lifecycle
obligations](https://github.com/nick-neely/tendnote/issues/570): a hosted
provider needs a **written no-training commitment** and **bounded retention**.
That ticket is still open, so no obligations register exists yet as a document;
the bar below is the one stated on #581, applied as written. Provider facts
here describe contracts and defaults. They do not choose a production model,
enable a setting, or make a legal conclusion.

## What Tendnote actually calls

Everything reaches a model through the **Vercel AI Gateway**, and nothing
reaches a provider directly.

- `apps/agent` and `apps/web` depend on `ai@7.0.84`, and `packages/db` does
  too. The only provider package resolved anywhere is `@ai-sdk/gateway@4.0.68`,
  pulled transitively (`pnpm-lock.yaml`). There is no `@ai-sdk/google`,
  `@ai-sdk/openai`, or `@ai-sdk/anthropic` in the tree.
- Call sites pass bare gateway model-id strings, so the AI SDK's default global
  provider resolves them: `google/gemini-3.7-flash` for the interactive agent
  and its subagents (`apps/agent/agent/agent.ts`, and the relationship
  strategist, message drafter, privacy guard, and memory curator, each of which
  falls back to `TENDNOTE_AGENT_MODEL`).
- `google/gemini-3.1-flash-lite` for extraction, `openai/text-embedding-3-small`
  for embeddings (`packages/db/src/queries/semantic-retrieval.ts`), and the
  snapshot model defaults to `TENDNOTE_AGENT_MODEL`
  (`apps/web/.env.example`).
- `openai/gpt-5.4-mini` is the eval judge (`apps/agent/evals/evals.config.ts`,
  `apps/agent/scripts/model-comparison.mjs`). Evals are a development path, not
  a hosted request path, but they carry the same content.
- `anthropic/claude-haiku-4.5` appears only as a commented alternative in
  `apps/agent/.env.local`. It is a candidate, not a configured provider.
- The single credential is `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN` on
  Vercel), in `apps/agent/.env.local` and optionally in the web app. There is no
  `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` anywhere in the repo, and no BYOK
  configuration.

So the configured surface is: **Vercel AI Gateway in front of Google Gemini
(agent, snapshots, extraction) and OpenAI (embeddings, eval judge)**. There is
no ADR on model selection or the gateway. [ADR
0227](../adr/0227-eve-interactive-tool-surface-uses-progressive-disclosure.md)
concerns the tool surface, not the provider. [Cost and reliability
evidence](../phase-9b/cost-and-reliability-evidence.md) names the same defaults
and records that the **Fallback Model's identity is still open**, alongside the
production model. That is the one hosted inference decision this research must
not pre-empt, and the bar below applies to whatever is chosen.

## The gateway layer

Vercel commits in writing on both halves of the bar, for its own layer.

No training: "AI Gateway does not use your prompts or responses for training
purposes. Your data is processed solely to fulfill your requests and is not
retained for model improvement." [Disallow Prompt
Training](https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training)
(page last updated 2026-09-08)

No content retention: "AI Gateway does not log the prompts or responses in your
requests. That content is not retained after the request completes." What it
records is metadata: status, model, provider, token usage, cost, duration, auth
method, and routing attempts. [AI Gateway
FAQ](https://vercel.com/docs/ai-gateway/faq) (2026-09-07) Routing attempt
details are kept **30 days**. [Request
Logs](https://vercel.com/docs/ai-gateway/observability-and-spend/logs)
(2026-09-07) Trace drains are opt-in and also metadata only: "AI Gateway traces
contain request metadata, but they don't include prompt or completion content."
[Trace Drains](https://vercel.com/docs/ai-gateway/observability-and-spend/trace-drains)
(2026-09-08)

The load-bearing qualification is that none of this reaches the provider.
Vercel says so itself: "Vercel's own retention policy does not constrain
providers, so enable these controls when you need a guarantee that covers the
whole path." And by default it does not filter: "By default, AI Gateway does not
route based on the training data policy of providers", assuming a provider
trains where Vercel has no agreement. [FAQ](https://vercel.com/docs/ai-gateway/faq),
[Disallow Prompt
Training](https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training)

**Tendnote sets neither filter today.** Two exist:

- `providerOptions.gateway.disallowPromptTraining: true`, per request, free,
  all tiers. Restricts routing to providers on Vercel's no-training list, which
  includes both `Google` and `Google Vertex AI`.
- `providerOptions.gateway.zeroDataRetention: true` per request (free), or a
  team-wide dashboard toggle at $0.10 per 1,000 successful requests. **Pro and
  Enterprise only.** Team-wide on overrides a per-request `false`. If no ZDR
  provider can serve the model the request fails with `no_providers_available`
  (HTTP 400) rather than downgrading silently. ZDR is a strict superset of the
  training filter. [Zero Data
  Retention](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)
  (2026-09-08)

Two carve-outs survive every setting. Prompt caching happens at the provider,
so its ZDR status is the provider's. And abuse review is explicitly outside
Vercel's control: "Regardless of your pinned region or retention settings, a
provider handles and retains requests it flags for abuse or safety review under
its own policies, which can fall outside your region. Vercel doesn't control
that or guarantee it beyond what the provider documents." [Regional
Inference](https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference)
(2026-09-08)

Residency is opt-in, `us` and `eu` only, default `global`, set via
`providerOptions.gateway.inferenceRegion`. A region that cannot be honored
fails with HTTP 400; there is no silent cross-region fallback. Pinning costs
about 10% more for both configured Gemini models. One limit matters: it pins
the provider, not the gateway, so "your request can terminate and be processed
in any Vercel region before AI Gateway forwards it to the provider." [Regional
Inference](https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference)

## Whose contract, which is the crux

With `AI_GATEWAY_API_KEY` alone, requests use what Vercel calls **system
credentials**: Vercel's own commercial accounts with the providers. Vercel is
the provider's customer; Tendnote is Vercel's. The terms that bind are the ones
Vercel negotiated, and Vercel says these can differ from public defaults: "A
provider's default policy may not match with the status that AI Gateway has in
place due to these agreements." [ZDR](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)

**Verified consequence:** Tendnote has no privity with Google or OpenAI on the
configured path. Google's Vertex abuse-monitoring opt-out form, the
project-region residency guarantee, and OpenAI's ZDR approval are properties of
Vercel's accounts, not exercisable or auditable by Tendnote.

BYOK reverses this and is available on paid tiers only: the request then runs
under "your own API key, your configuration, and agreement with the provider."
Two consequences cut against it. The `disallowPromptTraining` filter "is not
enforced since the request uses your own API key", and BYOK keys are skipped by
ZDR routing unless self-certified in the dashboard, with Vercel stating it "has
no visibility into your agreements with providers." Sharpest of all: "If a
query using your credentials fails, AI Gateway will retry the query with its
system credentials", and no documented switch disables that fallback.
[BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)
(2026-09-08)

The remaining gap is contractual rather than documentary. Vercel's
[DPA](https://vercel.com/legal/dpa) (last updated 2026-03-17, effective
2026-03-31) covers "the Services" generically and **contains no AI-specific
provision**: no mention of AI Gateway, models, or model providers.
Sub-processing is a pointer to the Trust Center list, with a five-day objection
window. That list does name inference vendors (Baseten, Cerebras, Fireworks,
Groq, xAI, plus Google, AWS, Microsoft) via
[vercel.com/legal/sub-processors](https://vercel.com/legal/sub-processors),
which redirects to [security.vercel.com](https://security.vercel.com/).
**Unverified:** whether OpenAI and Anthropic are named there, the per-entity
locations, and the list's last-updated date; the Trust Center render defeated
extraction. **Unverified:** whether the DPA is understood to cover AI Gateway
at all. That is a question for Vercel, not for its docs, and it is the single
most important thing to close before quoting any of this to a paying customer.

## Google Gemini, the agent and extraction path

Both configured models are live in the gateway catalog with `regions:
["eu","us"]`, and each is served by **two different providers with different
legal documents**: `google` (the Gemini Developer API) and `vertex` (Gemini
Enterprise Agent Platform, formerly Vertex AI). Which one serves a given
request is a routing outcome, not a repo setting.

**Developer API, paid.** "When you use Paid Services, including, for example,
the paid quota of the Gemini API, Google doesn't use your prompts (including
associated system instructions, cached content, and files such as images,
videos, or documents) or responses to improve our products". The boundary is
precise: "Your access to Gemini API is a 'Paid Service' only when accessing the
API through a Cloud Project associated with an active billing account." Unpaid
is the opposite, with human review and an explicit warning not to submit
sensitive or personal information. [Gemini API Additional Terms of
Service](https://ai.google.dev/gemini-api/terms) (effective 2026-03-23, last
updated 2026-04-28)

Retention on that path is the problem. The terms say only that for Paid
Services "Google logs prompts and responses for a limited period of time" for
abuse prevention and legal disclosure, and that the data "may be stored
transiently or cached in any country in which Google or its agents maintain
facilities." **No day count is published.** The older figure that circulates
does not appear in the current text, and Google's own guidance concedes the
point: "If your workload requires guaranteed zero data retention or enterprise
data processing agreements, use Vertex AI." [Zero data retention in the Gemini
Developer API](https://ai.google.dev/gemini-api/docs/zdr) Grounding with Google
Search or Maps stores prompts, context, and output for **30 days with no way to
disable it**; implicit caching is RAM-only with a 24-hour TTL.

**Vertex.** Stronger, contractual, and quantified. "Google will not use
Customer Data to train or fine-tune any AI/ML models without Customer's prior
permission or instruction" (§18), and §20(h) bars storing prompts outside the
customer's account beyond what is needed to produce the output. [Service
Specific Terms](https://cloud.google.com/terms/service-terms) (last modified
2026-07-29) Abuse logging is triggered, not blanket: if classifiers detect
suspicious activity Google "may log customer prompts solely for the purpose of
examining whether a violation" occurred, and "This data is stored securely for
up to **90 days** in the same region or multi-region selected by the customer
for their project", is not used for training, and is not CMEK-encrypted.
Customers under a Google Cloud Master Agreement are exempt by default, and
others may apply for an exception. [Abuse
monitoring](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/abuse-monitoring)
(no last-updated date shown, so read-date only) ZDR on Vertex is a checklist:
opt out of abuse logging, leave BigQuery request-response logging off (it is
off by default), set `store = false` on the Interactions API (it defaults to
`true`), skip Live API session resumption, and disable in-memory caching at the
project level. [Agent Platform and zero data
retention](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention)

Google's [sub-processor list](https://cloud.google.com/terms/subprocessors)
(last modified 2026-08-20) names support, data-labeling, and hosting vendors
rather than model providers, since Google serves Gemini itself. Data labeling
"only occurs if Customer elects to opt in."

**Verified and decision-relevant:** on Vercel's ZDR table, `Google Vertex AI`
appears and plain `Google` does not. Setting `zeroDataRetention: true` on
`google/gemini-3.7-flash` therefore forces the Vertex path or fails the
request. That is the better outcome regardless, because Vertex is the only
Google path with a published retention number and a documented opt-out.

**Inference, not verified:** because Vercel bills per token from an obviously
commercial account, the Gemini paid-tier no-training language should apply to
the system-credential path. No Vercel primary source states which Google
contract or account tier it uses, so this is not confirmed.

## OpenAI, the embeddings and judge path

Every page on `openai.com` and `help.openai.com` returned a bot challenge from
this environment, so the contractual API data-usage policy, privacy policy, and
sub-processor list **could not be read**. Everything below comes from
`developers.openai.com`, which is OpenAI's own primary developer documentation
and is reachable. It is documentation, not contract text. [Data controls in the
OpenAI platform](https://developers.openai.com/api/docs/guides/your-data) (no
effective date printed)

No training: "As of March 1, 2023, data sent to the OpenAI API is not used to
train or improve OpenAI models (unless you explicitly opt in to share data with
us)." The per-endpoint table reads `No` under "Data used for training" for
every endpoint, including `/v1/embeddings`.

Retention separates an abuse copy from application state: "By default, abuse
monitoring logs are generated for all API feature usage and retained for up to
**30 days**, unless longer retention is required by law, or is reasonably
necessary to protect our services or any third party from harm." Those logs
"may contain certain customer content, such as prompts and responses."

For Tendnote's two endpoints:

- `/v1/embeddings` (`text-embedding-3-small`): training `No`, application state
  `None`, abuse monitoring **30 days**, **ZDR eligible without qualification**,
  and not subject to the Eyes Off or Safety Retention carve-outs. This is the
  cleanest configured path in the entire stack.
- `/v1/chat/completions` and `/v1/responses` (the `gpt-5.4-mini` judge): same
  30 days, but ZDR eligible only "with limitations", and both are Eyes Off and
  Safety Retention eligible, meaning OpenAI reserves a written-notice right to
  make specific models ineligible for a customer's ZDR or MAM. The Responses
  `store` parameter also means response data is stored "for at least 30 days"
  when set, which is not a bounded window.

ZDR and Modified Abuse Monitoring are both **subject to prior approval by
OpenAI and acceptance of additional requirements**, obtained through sales.
Once approved they become self-configurable per organization and per project. A
CSAM classifier hit retains the image for manual review "even if Zero Data
Retention, Modified Abuse Monitoring, or Eyes Off is enabled."

Data residency is a sales-gated per-project configuration at a 10% uplift for
models released on or after 2026-03-05, and requires a Modified Retention
amendment for any region other than the United States.
`text-embedding-3-small` supports both regional storage and regional processing
in the US and EU. None of this is reachable through gateway system credentials.

## Anthropic, not configured, strongest written commitment

Included because `anthropic/claude-haiku-4.5` is a commented candidate and the
Fallback Model is undecided.

The no-training commitment is contract text, unconditional, with no
trust-and-safety carve-out: "Anthropic may not train models on Customer Content
from Services", where Customer Content is Inputs plus Outputs. [Commercial
Terms of Service](https://www.anthropic.com/legal/commercial-terms) (effective
2025-06-17) Customer Content is also designated Customer Confidential
Information. This is the only provider in this research whose no-training
promise was verified in a contract rather than in documentation.

Default retention is "within **30 days** of receipt or generation", with
exceptions for longer-retention services under your control, a ZDR agreement,
Usage Policy enforcement, and law. The flagged tail is quantified and long: "We
retain inputs and outputs for up to **2 years** and trust and safety
classification scores for up to **7 years** if your chat is flagged by our
automated trust and safety systems as violating our Usage Policy." [How long do
you store my organization's
data?](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
(2026-07-01)

ZDR is per organization, requires sales and Anthropic approval, and does not
extend automatically to other organizations. It covers the Messages API and
token counting; it excludes the Console and playground, Batch API, Files API,
code execution, Agent Skills, and consumer plans. CORS is unsupported under
ZDR. Safety classifier results are retained even under ZDR. Separately, a
Covered Models policy effective 2026-06-09 imposes a mandatory 30-day retention
floor with no ZDR on the Fable and Mythos families. **`claude-haiku-4.5` is not
a Covered Model**, so it stays ZDR-eligible in principle.

Data is "stored in the US" by default with traffic routed to select countries
in the US, Europe, Asia, and Australia. [Where are your servers
located?](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
(2026-06-15) The [sub-processor
list](https://trust.anthropic.com/subprocessors) names GCP, AWS, Azure, and
Cloudflare as worldwide infrastructure for all products.

## Against the bar

Written no-training plus bounded retention, per
[#570](https://github.com/nick-neely/tendnote/issues/570) as stated on #581.
Rows are the path as **currently configured**, through gateway system
credentials with no filters set.

| Provider | No-training in writing? | Retention | ZDR or bounded option | Meets the bar? |
| --- | --- | --- | --- | --- |
| Vercel AI Gateway (own layer) | Yes, docs. Not in the DPA | No prompt or completion content retained; metadata 30 days | ZDR is the default for Vercel's own layer, free, no action needed | **Yes**, for its layer only. Does not extend to providers |
| Google Gemini Developer API (`google`) | Yes for paid, in the Additional Terms | "a limited period of time", **no published number** | None. Google directs ZDR workloads to Vertex | **No.** Retention is not bounded in writing |
| Google Vertex (`vertex`) | Yes, Service Specific Terms §18 and §20(h) | Triggered abuse logging only, **90 days** in the project's region | Opt-out form, or exempt by default under a Cloud Master Agreement | **Yes**, but the commitments run to Vercel, not Tendnote |
| OpenAI `/v1/embeddings` | Yes in docs; contract text unreadable from here | Abuse monitoring **30 days**; application state none | ZDR eligible unqualified; approval-gated via sales | **Yes**, subject to confirming the contract wording |
| OpenAI `/v1/chat/completions` (judge) | Same | 30 days, plus "at least 30 days" when `store` is set | ZDR "with limitations"; Eyes Off and Safety Retention reserved | **Partially.** Bounded by default, not guaranteed |
| Anthropic (candidate, not configured) | **Yes, in the Commercial Terms.** Strongest artifact found | 30 days default; **2 years** flagged content, **7 years** classifier scores | ZDR per organization, sales and approval gated | **Yes on default**, with a long flagged tail to accept explicitly |

The single finding that matters most is not in the table. Every "yes" above
except the gateway's own row is a commitment **Google or OpenAI makes to
Vercel**, because Tendnote holds no provider credential. Meeting the #570 bar
in a way Tendnote can assert to a paying customer requires either a written
answer from Vercel that its DPA covers AI Gateway and which provider terms
apply on the system-credential path, or moving to BYOK so the provider terms
run to Tendnote directly. BYOK carries its own cost: the paid tier, a
self-certified ZDR claim, and an undisableable failover to Vercel's credentials
when a key fails.

## Limits and what to verify later

No provider account, gateway setting, or dashboard was inspected or changed,
and no request was sent. These are published contracts and documentation, not
confirmation of how Vercel's own accounts are configured. Pin document versions
when any of this is quoted in a privacy policy.

Unverified and worth closing before launch: whether Vercel's DPA covers AI
Gateway; which Google and OpenAI contracts Vercel operates under for
system-credential routing; whether OpenAI and Anthropic appear on Vercel's
sub-processor list and with what locations; OpenAI's contractual no-training
and sub-processor pages, which were unreachable from this environment and
should be read directly from a browser; and whether an AI Gateway transcript or
content-capture feature exists, since a search summary referenced one that the
live logs documentation does not contain.

Still decisions, not facts: the production model, the Fallback Model's
identity, whether to enable `disallowPromptTraining` or `zeroDataRetention`,
whether to pin `inferenceRegion` and absorb the roughly 10% uplift, whether to
move to BYOK, and whether the eval judge path needs the same treatment as the
hosted path. No legal conclusion is made here; the sub-processor disclosure and
DPA questions are the ones flagged for professional review under #570.
