# Hosted Tendnote Is US-Only And Has No Free Tier

A hosted Tendnote holds an unusual data class. Every account contains context
about third parties who have no account, never agreed to any term, and cannot
be authenticated by the service. Relationship memories, sensitivity
classifications, and surprise-excluded gift plans all describe people who are
not customers.

The GDPR household exemption does not help the provider here. It covers a
natural person processing data in the course of a purely personal activity,
which describes the *user* keeping notes about their friends. Recital 18 is
explicit that the Regulation still applies to controllers and processors that
provide the means for such personal activity. The user is exempt and the
operator is not.

## Decision

**Hosted Tendnote serves the United States at launch and geo-blocks the EU.**

Serving the EU means owing data subject rights to people who are not customers
and cannot log in to exercise them, which requires a deliberate compliance
workstream: a privacy policy that covers non-user data subjects, a documented
process for handling an access or erasure request from someone who has never
heard of Tendnote, and the data processing agreements that go with it. That
work is deferred rather than skipped, and the geo-block is what makes deferring
it honest.

**There is no free hosted tier. Self-hosting is the free tier.** Every hosted
account demonstrates willingness to pay before consuming a token of inference.
This is a product decision with an architectural consequence: the admission
model has no trial state, and payment precedes product access rather than
following a grace period.

The price is set after the tool-surface reduction and model selection in ADR
0227, because per-user cost is not yet known and pricing ahead of it is a
guess.

## Consequences

Acquisition cannot rely on a free-trial funnel. It depends instead on the
published repository and the self-hosting path, which is consistent with ADR
0228 placing publication first.

EU availability is a future workstream with a real cost, not a configuration
change. Geo-blocking is reversible at any time; an EU launch made without the
compliance work is not.

Operating in the United States does not remove state-level obligations, and a
future state privacy regime may impose comparable duties. This ADR records that
the EU is the deferred jurisdiction, not that no obligations exist.

The severity of a breach remains higher than for typical SaaS regardless of
jurisdiction, because the exposed data describes people who never accepted the
risk. Retention minimization, scope enforcement in the query layer, and the
sensitivity tiers are load-bearing controls rather than product polish.
