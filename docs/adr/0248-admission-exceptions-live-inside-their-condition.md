# Admission Exceptions Live Inside Their Condition

Hosted admission is projected from Stripe state plus Tendnote's own records:
dunning expiry, refunds, disputes, suspensions, terminations, and operator
grants. The lifecycle decision allows the operator to override some of these
by hand, for example extending a dunning window or re-admitting after a won
dispute. The obvious design is a single precedence list where each record
type outranks the ones below it. That design cannot express the exceptions:
dunning expiry must outrank a generic grant, yet the grant exists to override
that expiry, and a dispute revocation must outrank re-admission, yet
re-admission exists to undo a specific dispute.

## Decision

**Each blocking condition owns its exceptions.** A block is evaluated together
with the exception records that name it. A dunning extension names the failed
invoice and overrides only that invoice's window. A re-admission grant names
the resolved dispute and is void against any later dispute. A refund revokes
only the refunded subscription. Suspension and Termination admit no
exceptions and end only by their own audited transition. A Legal Hold names
the data it covers and blocks only that deletion.

**Admission is granted when at least one source admits and no unexcepted
block is active.**

**Operator changes are records, never edits.** Every Operator Action produces
an append-only record with explicit scope and expiry. The current admission
state is a projection recomputed from Stripe and these records; the records
are the audit history. Direct edits to the projection are prohibited, so
Stripe reconciliation cannot overwrite an operator decision and an operator
decision cannot silently outlive the event it addressed.

## Consequences

There is no global precedence table to maintain, and no generic "override"
record. Adding a new block type means defining its exception record, or
stating that it has none.

A grant that names a specific invoice or dispute cannot be reused. The
operator issues a new record for each event, which is more entries and less
ambiguity.

Database recovery must reconcile admission from these records and from
Stripe, not from restored projection rows. The recovery procedure in
[Bounded usage and the author-operated support contract](../phase-9b/bounded-usage-and-support-contract.md)
depends on this.
