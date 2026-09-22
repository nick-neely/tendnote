# Billing during a Temporary Suspension

Decision artifact for [Decide the Temporary Suspension billing policy and its
open edges](https://github.com/nick-neely/tendnote/issues/587). It fixes what
happens to the Stripe subscription while a suspension is open, whether dunning
keeps running, what the customer is told and when, how already-paid suspended
days are compensated at the audited exit, which refunds revoke Paid Access,
what happens when the customer cancels mid-review, and whether Termination
returns the unused remainder. It resolves the billing item left open by
[Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md)
and adopts the recommendation of
[Stripe billing semantics during Temporary Suspension](../research/phase-9b-stripe-suspension-billing.md).

It does not decide the suspension review procedure itself, the runbook text
for any Operator Action, the Terms wording that describes the credit, or the
sandbox evidence the mechanism still owes. Those are listed at the end.

## Facts this decision rests on

- Stripe's two pause features both fail here. `pause_collection` keeps the
  service and stops the money, which is the inverse of a suspension, and it
  does not compensate prepaid days or stop an in-flight dunning retry. The
  pause-subscriptions endpoint has the right semantics but requires a preview
  API version and flexible billing mode, truncates `current_period_end` to
  the pause time, and can return 200 while leaving the subscription `paused`
  ([Stripe billing semantics during Temporary Suspension](../research/phase-9b-stripe-suspension-billing.md)).
- Admission is already denied by the suspension record alone. Each blocking
  condition owns its exceptions, Temporary Suspension has none, and direct
  edits to the Stripe projection are prohibited
  ([ADR 0248](../adr/0248-admission-exceptions-live-inside-their-condition.md)).
  Nothing in Stripe needs to know a review is open for admission to be
  correct.
- The Usage Period is anchored to the subscription's start day and its reset
  date is displayed in every budget notice
  ([The paid offer and price](paid-offer-and-price.md)). Any anchor change
  silently re-dates that display and hands out a fresh allowance.
- A credit note is the instrument that adjusts a finalized invoice without
  voiding it, works on a `paid` invoice, and records which line item was
  credited. With Stripe Tax enabled a credit note cannot carry a custom line
  item, so the credit must be expressed against the subscription's
  `invoice_line_item`.
- The lifecycle decision fixed period-end cancellation with no partial
  refund, a fourteen-day first-purchase guarantee, and immediate revocation
  on refund or dispute
  ([Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)).
- Suspension has a ten business day internal review deadline and ends only by
  an audited Lift or Termination. It is a review state, not a billing state.

## Nothing in Stripe is touched while a suspension is open

**During a Temporary Suspension, Tendnote makes no Stripe call at all.** No
`pause_collection`, no pause endpoint, no subscription schedule, no billing
cycle anchor change, no trial extension. The subscription stays `active`,
invoices finalize and are paid on the existing anchor, the period keeps
advancing, and the Stripe projection keeps Paid Access true. Admission is
denied by the suspension record, which is already the authority.

This is a deliberate split: Stripe holds the money relationship, Tendnote
holds the admission decision, and a review is an admission event. Teaching
Stripe about reviews buys nothing and costs a preview API version, a
truncated period end, and a resume path that can fail silently.

**The accepted tradeoff.** A renewal can be charged in the middle of a review
for a product the customer cannot reach. The money is not returned at the
moment of the charge; the credit arrives at the audited exit. The operator
accepts this because the alternative instruments are worse, because the
review deadline is ten business days rather than months, and because the
compensation is exact rather than approximate.

Resumption does nothing, because nothing was suspended in Stripe. The lift is
an admission transition plus a credit note. `billing_cycle_anchor` and
`proration_behavior` never come up, and the displayed "Resets on <date>"
stays true throughout.

## Dunning runs normally inside an open suspension

A renewal that fails during a suspension starts the ordinary seven-day
dunning window. If the window closes before the review ends, the account is
Lapsed and Suspended at once: both records exist, both are true, and
admission stays denied by either.

Holding dunning would mean inventing a second pause with its own expiry and
its own failure modes, on the least common path in the system. The existing
**Extend dunning once** Operator Action already covers the case that matters,
where the operator judges that the failure was caused by the review itself,
and it produces a record naming the failed invoice like any other Admission
Exception.

## What the customer is told, and when

**The suspension notice states the rule, not a number:** days under review
are credited when the review ends. **The exit notice states the amount**, the
invoice it was credited against, and the instrument.

The restricted pending area shows no running figure. A live counter would be
a promise made before the arithmetic is final, it would move every day, and a
review that ends in Termination would have been quoting a customer a credit
against an account about to be closed. One rule up front and one exact number
at the end is the honest pair.

## Suspension Credit

**Suspension Credit** is a new Operator Action. At the audited exit of a
suspension, Lift or Termination alike, it issues exactly one credit note per
paid invoice whose period overlaps the suspension, each crediting that
invoice's subscription `invoice_line_item` by amount.

**The arithmetic is time-based.** For each such invoice, take the overlap of
the interval from the suspension start to the exit with the invoice's period,
capped at the period end, and capped at the cancellation period end if the
customer cancelled. Divide that overlap by the length of the invoice period,
multiply by the line's net amount, and round down to the cent. All timestamps
are UTC and are read from the suspension record and the invoice, never from
wall-clock at exit time.

Net amount, not list amount: a percentage or fixed discount spreads
proportionally across line items, so the credited line returns what the
customer actually paid for it.

**A credit is issued whenever the result is at least one cent.** There is no
one-day floor. A floor would be a second rule to remember, it would need its
own disclosure, and it would make a short suspension the only case where the
stated rule does not apply.

**The instrument depends on whether a future invoice exists.**

| Situation at exit | Instrument |
| --- | --- |
| Subscription will produce a future invoice | `credit_amount`, onto the customer credit balance |
| Cancelled, Lapsed, or the exit is Termination | `refund_amount`, back to the card |

A balance credit on an account that will never be invoiced again is money
the customer cannot reach, which is not compensation. A card refund where a
renewal is coming is a needless card operation and a reconciliation event.
The rule is the same question in both directions: will anything consume this.

Stripe Tax reverses in proportion to the credited line. That proportional
behaviour, and the order in which a customer balance is consumed, are sandbox
checks handed to launch evidence rather than settled here.

## Which refunds revoke Paid Access

**Revocation is keyed to the refund's origin, not its amount.**
Reconciliation revokes Paid Access on a Stripe refund only when the refund
matches a Tendnote **Refund** Operator Action record. A refund matching a
**Suspension Credit** record never revokes. A refund matching neither record
changes nothing and raises the Stripe webhook reconciliation alert until the
operator records what it was.

Disputes are unchanged: Stripe's signal, immediate revocation, manual
re-admission if the dispute is later won.

Narrowing the old rule to full refunds was rejected. Amount is an accident of
arithmetic, and a one-day suspension credit can equal a partial goodwill
refund to the cent. An unexplained refund taken in the Stripe dashboard
should alert rather than silently change a customer's access.
[ADR 0249](../adr/0249-refund-revocation-is-matched-to-its-operator-action-record.md)
records this.

## Record before act

**Every Refund and Suspension Credit writes its record before the Stripe
call.** The record names the suspension where there is one, the invoice or
invoices, the amount, and the instrument. The Stripe credit-note or refund id
returned by the call is then stored on that record.

This is the Deletion Record's shape: the durable intent precedes the
irreversible effect, so a Stripe call that succeeds while its response is
lost is still explained by a record reconciliation can match. These records
reach the Recovery Journal like the other operator records, so a restore
reconciles admission against them rather than against restored projection
rows.

## The customer cancels mid-suspension

Cancellation behaves exactly as it does today: self-service in the portal,
effective at period end, no partial refund for the cancellation itself. The
review continues. Cancelling is not a way to end a review.

If the period ends before the review does, the account becomes Lapsed with
the suspension record still attached, and the ninety-day retention clock
starts as usual. A Legal Hold blocks deletion of whatever data the review
needs.

The Suspension Credit is still issued once, at the exit, counting suspended
time only up to the cancellation period end, and as a card refund because no
future invoice exists to consume a balance.

## Termination returns the unused remainder

**Product default: a Termination refunds the unused remainder, from the
termination time to the period end, as `refund_amount` on the same credit
note that carries the suspended time.** In effect the customer is refunded
from the suspension start through the period end.

This differs from cancellation and from deletion, which return nothing,
because those are the customer's choice and this is the operator's. Keeping
money for a period the operator decided the customer may not use is a bad
position to hold in a dispute and a worse one to explain.

This is a counsel-reviewed default, not a counsel question. The Hosted
Obligations Register row moves from an open counsel item to a decided default
awaiting counsel review of the Terms wording.

## Failure cases this policy carries

- A renewal is charged mid-review for a product the customer cannot reach.
  The credit arrives at the exit, not at the charge.
- A renewal fails mid-review and the seven-day dunning window closes against
  an account nobody is using. The account is Lapsed and Suspended at once,
  and the operator's only remedy is the existing single dunning extension.
- A review that outlasts a billing period produces more than one credit note
  at exit, one per overlapping paid invoice, and the customer has paid twice
  before seeing anything back.
- A `credit_amount` credit is stranded if the customer cancels after the
  credit is issued but before the next renewal. The instrument rule is read
  at exit and cannot see the future.
- A Stripe call that succeeds while its response is lost leaves a record with
  no id on it. Reconciliation matches on subscription, amount, and time
  window, and the operator repairs the record.
- A refund taken directly in the Stripe dashboard alerts and changes no
  access until it is recorded. An operator who forgets leaves an open alert
  rather than a wrong admission state.

## Sandbox checks handed to launch evidence

To be verified in a Stripe sandbox with Stripe Tax enabled and test clocks,
before the policy is relied on:

- A partial `invoice_line_item` credit note reverses that line's tax in
  proportion, and appears in the itemized export as `type=credit_note`,
  `transaction_type=reversal`.
- `credit_amount` on the customer balance is consumed by the next renewal
  invoice ahead of the card.
- The credited amount matches the discounted line amount when a coupon is
  present.
- A renewal failure inside an open suspension interacts with the seven-day
  dunning window as described, including the single dunning extension.
- The account's billing mode (classic or flexible), which decides whether the
  pause endpoint is reachable at all should the revisit trigger ever fire.

## Revisit condition

Revisit only if reviews routinely outlast a billing period. At that point the
honest instrument is the GA pause-subscriptions feature, once it leaves
preview, with `bill_for[unused_time_from]=now` and
`billing_cycle_anchor=unchanged` on resume. Until then, one credit note per
suspension by hand is less machinery than a pinned preview API version, a
billing-mode migration, and a resume path that can return 200 and leave a
customer paused.

## Glossary

`CONTEXT.md` gains Suspension Credit.

## ADR

[ADR 0249](../adr/0249-refund-revocation-is-matched-to-its-operator-action-record.md)
records the durable part: a refund revokes Paid Access only when it matches
its Refund Operator Action record, a Suspension Credit never revokes, an
unmatched refund alerts, and every refunding action writes its record before
the Stripe call. The rest of this artifact is launch policy a later decision
may reasonably revise.

## Hand-offs

- [Define the hosted incident, data-request, and deletion-notice runbooks and
  the pre-launch tabletop](https://github.com/nick-neely/tendnote/issues/582):
  the Suspension Credit and Refund runbooks, the record-before-act ordering,
  and the suspension and exit notice templates.
- [The paid offer and price](paid-offer-and-price.md): the Terms wording for
  suspended-time credits and the termination remainder sits beside the refund
  and cancellation terms recorded there.
- Hosted Obligations Register: the termination remainder default and the
  suspended-time credit wording, both counsel review.
- Launch evidence: the sandbox checks listed above.

## Not decided here

The suspension review procedure and its deadline renewals, the runbook text
for any Operator Action, the Terms and notice wording, the Recovery Journal
write path for these records, and the sandbox-verified behaviour of
proportional tax reversal, balance consumption order, and coupon interaction.
