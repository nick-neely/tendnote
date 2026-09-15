# Paid Access Is A Hosted Admission Source Owned By The Account

ADR 0226 settled that hosted Tendnote has no free tier and that payment
precedes product access, but it did not say what payment evidence means, who
buys, or what happens after payment stops. ADR 0067 left the Access Profile as
the durable record of admission with room for "future billing or role fields",
and that room is what this decision fills.

Two obvious paths are wrong here. Asking Stripe at request time whether to
admit someone makes every page load depend on a third party and turns a webhook
delay into a lockout. Reading a Stripe subscription status as the entitlement
is no better: `active` does not prove an invoice was paid, and refund,
cancellation, and access revocation are three separate operations that no
single provider field summarizes.

## Decision

**Paid Access is a Tendnote-owned admission source, projected from Stripe and
never queried from it.** It is the durable fact that a hosted account holds
verified payment standing, and it sits beside Private Beta Access rather than
replacing it. Hosted admission is a Better Auth session plus Private Beta
Access, Paid Access, or Household Guest, plus ADR 0226's geo check. The Access
Profile remains the record of admission; Stripe is the record of money.
Webhooks and an idempotent reconciliation job write Paid Access; the request
path reads it locally.

**One account, one subscription.** Every hosted person who wants full product
access pays for their own, including an invited Household Member. The unit of
purchase matches the unit of data ownership, so no one's cancellation removes
another person's access.

**Admission is granted by the first invoice paid, and launch is card-only.**
Not a Checkout redirect, not an `active` subscription. Cards keep that evidence
synchronous at checkout; delayed payment methods need a provisional state and
are a deliberate later addition.

**A lapsed account keeps its data for ninety days.** Paid Access ends by a
closed dunning window, a cancellation reaching period end, a refund, or a
dispute. The account stays signed in and unadmitted, with resubscribe, export
per ADR 0231, and delete. The deadline is computed once in the domain and read
by both the copy and the deletion sweep, as in ADR 0221.

**Household Guest is the only hosted state that reaches any product surface
without payment.** It is an unpaid account that accepted a Household
Invitation: read-only over household-native, household-scope, and
shared-to-them records, with no private records, no Eve, no capture, no edits,
no reminders, no exports, and no provider connections. It consumes no
inference. It has no expiry, and it is alive only while at least one active
Household Owner of that household holds Paid Access.

**This amends ADR 0226's "no free hosted tier" clause by carving out Household
Guest.** ADR 0226 stands otherwise, including the geo-block, the absence of a
trial state, and self-hosting as the free tier. The carve-out is warranted
because the clause's actual purpose is that no account consumes inference
before demonstrating willingness to pay, and a guest consumes none: someone
else is already paying for that household, and the guest only reads pages that
household already generated. The alternative, requiring payment before an
invitation can be accepted, makes Household unusable at a scale where no one
has heard of Tendnote, and it lets an invitation expire on a person who is
mid-checkout. The exception is bounded by a paying sponsor rather than by a
timer, so it cannot become a standing free tier.

## Consequences

Admission stays a single local boolean, so Past Due and Ending are notices on
an admitted account rather than new admission branches, and a Stripe outage
cannot lock out a paying customer.

Reconciliation must be idempotent and recoverable from current Stripe objects,
because webhook delivery duplicates and reorders. Accepting an HTTP delivery is
not durable completion.

Private Beta Access survives as a mechanism for the operator account and future
admission experiments, but stops being a route to the product without paying.
Existing beta grants end on a stated launch date; the author's account is kept
by `manual_grant`.

Household Guest gives the query layer a third caller class to enforce, not just
a new flag. Every read path that a guest can reach must exclude private records
by scope rather than by UI omission, and the guest's dependency on a paying
Owner is checked rather than cached.

A refund or dispute revokes access immediately, so support work exists at
launch: a won dispute does not re-admit anyone automatically, and the author
re-admits by hand.

Paid Access is hosted-only. No Stripe code path runs in a self-hosted
deployment, and Self-Hosted Admission Mode under ADR 0232 is unchanged.

References: #567,
[ADR 0067](0067-private-beta-access-uses-vercel-flags.md),
[ADR 0214](0214-household-native-records-are-owned-by-the-workspace.md),
[ADR 0221](0221-household-erasure-closes-the-recovery-window-it-opens.md),
[ADR 0226](0226-hosted-tendnote-is-us-only-and-has-no-free-tier.md),
[ADR 0231](0231-owner-data-export-is-owner-scoped-and-portable.md),
[ADR 0232](0232-self-hosted-admission-is-explicit-and-household-bounded.md),
[the decision artifact](../phase-9b/subscription-ownership-and-paid-access-lifecycle.md).
