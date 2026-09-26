# The paid offer and price

Decision artifact for [Decide the paid offer and price from measured
evidence](https://github.com/nick-neely/tendnote/issues/573). It fixes what
evidence the launch price rests on, the plan, the price and billing intervals,
the usage numbers that the price derives, how those limits are published, and
the refund and cancellation terms as they apply to each interval. It does not
choose the Fallback Model or the production model (settled in
[Production and Fallback models](production-and-fallback-models.md)), build
anything, or create Stripe products.

All decisions below were confirmed by the owner in the grilling session of
2026-09-21.

## Evidence the price rests on

| Workload | Provider charges | Per Eve turn |
| --- | ---: | ---: |
| Light (40 turns) | $2.46 | $0.061 |
| Typical (150 turns) | $6.35 | $0.042 |
| Heavy (600 turns) | $22.99 | $0.038 |

Source: [Baseline cost replay](baseline-cost-replay.md). Interactive Eve is
about 96% of the heavy month ($22.06 of $22.99 including reporting writes);
extraction, embeddings, snapshots, and scheduled work together are under
$1.10. Interactive input averaged about 55k tokens per call, so the cost basis
is dominated by the undisclosed tool surface that
[ADR 0227](../adr/0227-eve-interactive-tool-surface-uses-progressive-disclosure.md)
would shrink.

**Sufficiency.** One sample per workload is accepted as the price basis. No
further paid replay is a prerequisite. Repeat replays would measure model
variance on a synthetic workload; the larger unknown is real customer
behaviour, which only the Usage Ledger can observe. Unmeasured variance is
absorbed by the margin and by the hard Account Ceiling, which holds at any
price.

**Price on today's ceiling.** The price is set against the current tool
surface and default model. Disclosure is not a pricing prerequisite. After
disclosure ships and one Usage Ledger month exists, the allowance is revisited
first and the price second: widening an allowance is always safe, raising a
price is not.

**Verified rates** (vendor pages, accessed 2026-09-21):

| Item | Rate |
| --- | --- |
| Stripe card processing | 2.9% + $0.30 |
| Stripe Billing | 0.7% of volume |
| Stripe Tax | 0.5% per transaction where registered |
| Exa web search through the AI Gateway | $7 per 1,000 requests, up to 10 results each |

## The offer

- **One plan at launch**, sold per account, in two billing intervals.
- **$20 per month**, or **$200 per year** ("two months free").
- Prices are tax-exclusive; Stripe Tax adds applicable sales tax at checkout
  and the pricing page says "plus applicable sales tax".
- No free tier, no trial. Self-hosting remains the free option and is shown on
  the pricing page beside the paid plan.

Net revenue after worst-case payment fees is $18.88 for a monthly subscriber
and $191.50 a year, **$15.96 per month**, for an annual subscriber. Every
derived number below uses the annual figure, because it is the lowest
effective monthly revenue an admitted account can represent.

**The allowance is a plan attribute, not a constant.** The entitlement carries
its usage numbers with the plan so a higher tier can be added without rework.

**A second plan is deferred, with a trigger.** A higher-allowance tier is added
once the Usage Ledger shows real accounts reaching the soft budget. Its
allowance and price then come from measurement, and the over-budget notice
becomes its natural point of sale. At launch the annual toggle and the free
self-hosting option are the price anchors. Launching two tiers now would size
the upper one on a guessed 600-turn month, reopen the approved one-plan signup
and marketing artifacts, and add upgrade and downgrade proration paths for a
one-operator service.

## The Usage Period

Budgets and ceilings reset on the **Usage Period**: one month, anchored to the
day of the month the subscription started, for every subscriber regardless of
billing interval. A monthly subscriber sees no difference from the Stripe
billing period. An annual subscriber gets twelve resets a year. The displayed
"Resets on <date>" is the Usage Period reset. This amends the earlier wording
in [Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md)
that tied the reset to the Stripe billing period.

## The numbers the price derives

The Account Ceiling totals **$14.00** per Usage Period, leaving a worst-case
contribution of about **$2** per account per month against the $15.96 floor.
The worst case requires an account to sit at every ceiling every month.

| Cost category | Fair-Use Budget (soft) | Account Ceiling (hard) | Basis |
| --- | ---: | ---: | --- |
| Interactive Eve | $10.50 | $12.00 | Soft is about 1.65x the typical month, roughly 250 full-quality turns; the $1.50 between soft and hard is Fallback Model headroom |
| Background (extraction, embeddings, snapshots, scheduled) | none; defers in its normal pending state | $1.30 | The heavy month measured $1.10 |
| Web search | none; no cheaper substitute exists | $0.70, which is 100 searches | $0.007 per search, requests held to the default 10 results |

The Fair-Use Budget is therefore not where the heavy month is profitable; it is
where full quality ends. The heavy Representative Month exceeds it by design
and continues on the Fallback Model, then pauses at the ceiling. Profitability
of every admitted account is guaranteed by the Account Ceiling, not by the
soft budget. `CONTEXT.md` and
[Cost and reliability evidence](cost-and-reliability-evidence.md) are amended
to say so.

How many turns the $1.50 of fallback headroom buys depends on the Fallback
Model. [Production and Fallback models](production-and-fallback-models.md)
chooses GPT-6 Luna, estimated at 200 to 300 further turns and unpublished until
qualification measures it.

**Contribution at the typical month.** About $9.30 for an annual subscriber
and $12.20 for a monthly one, after $6.35 of model spend and an assumed $0.30
of background spend.

## Fixed infrastructure

Fixed hosting is not loaded into the price. The author runs this stack for
their own use and the private beta regardless, and the binding owner rule is
about per-account variable cost. The fixed total is recorded so a break-even
count is known.

| Service | Low | High |
| --- | ---: | ---: |
| Vercel Pro, one seat, $20 usage credit included | $20 | $20 |
| Neon Launch, usage-based, tiny database (estimate) | $11 | $11 |
| Upstash Redis, free tier or $10 fixed plan | $0 | $10 |
| Resend, free to 3,000 emails a month or Pro | $0 | $20 |
| Hosted GlitchTip, free to 1,000 events or Small | $0 | $15 |
| Vercel Blob for the Recovery Journal, inside the Pro credit | $0 | $0 |
| **Total** | **$31** | **$76** |

These are estimates from vendor pricing pages accessed 2026-09-21, not the
owner's invoices; a domain adds a dollar or two. At about $10 of contribution
per typical account, fixed costs are covered at roughly **three to eight paying
accounts**. The figure is internal and informational. It is replaced with
invoice totals once a billed month exists.

## Refund, cancellation, and interval changes

The terms in [Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)
are unchanged and apply identically to both intervals:

- A fourteen-day money-back guarantee on a first purchase, refunded in full on
  request. For an annual first purchase that is the full $200.
- Cancellation takes effect at period end with no partial refund. An annual
  subscriber who cancels in month three keeps access until month twelve. The
  pricing page and checkout say this plainly.
- No service credits.
- Monthly to annual is allowed in the portal at any time. Annual to monthly
  takes effect at the end of the paid year.
- **A renewal reminder email precedes every annual renewal.** It is sent
  regardless of what counsel concludes about state automatic-renewal law,
  because it costs almost nothing and prevents disputes. Whether a statute
  requires it, and with what notice window, is a counsel item added to the
  Hosted Obligations Register. It joins the content-free launch email set.

## How fair use is published

Dollars are the internal unit and the unit of enforcement. The public claim is
in approximate Eve turns: "about 250 full-quality turns a month, then a
lighter model", 100 web searches a month, and the Usage Period reset date. The
turn count is stated as an estimate, and the fair-use page shows the
dollar-to-turn conversion so the claim stays honest as per-turn cost moves.

## Reconciliations made with this decision

- `CONTEXT.md`: adds Usage Period; amends Fair-Use Budget and Account Ceiling.
- [Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md):
  the reset is the Usage Period.
- [Cost and reliability evidence](cost-and-reliability-evidence.md): the
  Fair-Use Budget is where full quality ends; the ceiling guarantees
  profitability.
- [Marketing site and demo experience](marketing-site-and-demo-experience.md)
  and [Self-service signup through First Value](self-service-signup-through-first-value.md):
  the pricing placeholders resolve to this offer; one plan stands, with an
  interval choice at pricing and checkout.
- [Hosted privacy and customer-lifecycle obligations](hosted-privacy-and-customer-lifecycle-obligations.md):
  the register gains the annual-renewal reminder row.

No ADR is recorded. A price, an allowance, and a billing interval are all
cheap to revise and unsurprising; the hard-to-reverse boundaries they sit on
are already in ADR 0246 and ADR 0248.

## Not decided here

The Usage Ledger schema; the second plan's allowance and price; the
pricing page's wording and design.
