# Refund Revocation Is Matched to Its Operator Action Record

Tendnote revokes Paid Access when a subscription is refunded. That rule was
written when a refund could only mean one thing: the fourteen-day guarantee,
or a goodwill return, both of which end the customer's claim on the product.
The Temporary Suspension billing policy introduces a second kind of money
going back to the card. A Suspension Credit compensates days the customer
paid for and could not reach, and it is issued as a card refund whenever the
subscription will produce no future invoice to absorb a balance credit. Read
by the old rule, paying a customer back for a suspension they survived would
revoke the access the operator just restored.

The obvious narrowing is by amount: revoke on a full refund, ignore a partial
one. Amount is an accident of arithmetic. A one-day credit on a monthly
subscription and a partial goodwill refund can be the same number of cents,
and a suspension that covered a whole period produces a credit equal to the
invoice. The amount does not carry the reason.

## Decision

**A Stripe refund revokes Paid Access only when it matches a Refund Operator
Action record.** Reconciliation looks the refund up against Tendnote's own
records, not at its size:

- A refund matching a **Refund** record revokes Paid Access on the refunded
  subscription, as before.
- A refund matching a **Suspension Credit** record never revokes anything.
  It is compensation for denied service, not the unwinding of a sale.
- A refund matching neither record changes no admission state and raises the
  Stripe webhook reconciliation alert. The operator records what it was, and
  reconciliation then reads the record.

**Every Refund and Suspension Credit writes its record before the Stripe
call.** The record names the subscription, the invoice or invoices, the
amount, the instrument, and for a Suspension Credit the suspension it
compensates. The Stripe credit-note or refund id is stored on that record
when the call returns. This is the ordering the Deletion Record already uses:
the durable intent precedes the irreversible effect, so a refund that
succeeds while the response is lost is still explained.

Disputes are unchanged. A dispute is Stripe's signal about a payment
Tendnote did not initiate, there is no Tendnote record to match, and it
revokes immediately.

## Consequences

An unexplained refund taken in the Stripe dashboard no longer silently
changes a customer's access. It alerts instead, which is the correct
behaviour for a money movement nobody in Tendnote asked for, and it makes
the dashboard a worse place to refund from than the runbook. That is
intended.

Reconciliation gains a lookup it can fail. A refund whose record write
succeeded but whose id write did not is matched on subscription, amount, and
time window rather than id; that reconciliation is idempotent and may be run
again after the operator repairs the record.

Adding a new reason to send money back means adding its Operator Action and
saying whether it revokes. There is no default for an unclassified refund
beyond the alert.

## Alternatives considered

**Revoke on a full refund, ignore a partial one.** Rejected because the
amount is arithmetic, not intent. A full-period suspension credit is a full
refund and would revoke; a partial goodwill refund would not, leaving a
customer who was refunded most of their money still admitted.

**Revoke on any refund, and re-admit by hand afterwards.** Rejected because
it makes every Suspension Credit a two-step operator dance with a window in
which a customer whose suspension was just lifted is locked out again. It
also spends the re-admission grant, which names a resolved dispute, on
something that was never a dispute.

**Tag the refund in Stripe metadata and read that back.** Rejected because
it puts the authority for a Tendnote admission decision inside the payment
provider, which
[ADR 0245](0245-paid-access-is-a-hosted-admission-source-owned-by-the-account.md)
and [ADR 0248](0248-admission-exceptions-live-inside-their-condition.md)
both refuse. Metadata is written by the same call whose response can be lost,
so it cannot be the durable record either.
