# Hosted Inference Is Metered Content-Free And Shed In A Fixed Order

ADR 0226 deferred the hosted price until per-user cost was measured, and the
service is not externally funded, so an account that costs more than it pays
is a real loss rather than a growth expense. Measuring cost per account
invites two mistakes: a usage record rich enough to become a second content
store, and a cost control that quietly changes what Eve is allowed to do.

## Decision

**Per-account usage is recorded content-free.** The Usage Ledger holds daily
rollups of model id, cost category, tokens in and out, call count, and stored
bytes, retained thirteen months. It never holds prompts, replies, or record
identifiers, following ADR 0242's rule for Activation Milestones. It is a
launch requirement and not a price prerequisite; price comes from a replayed
Representative Month, and the ledger checks production against it.

**Budgets change pace and model, never authority.** A Fair-Use Budget is soft.
Crossing it shows a notice and moves interactive turns to a cheaper Fallback
Model that has passed the policy-tagged evals at least once; extraction defers
in its normal pending state. ADR 0128's mode gate, approval gates, and egress
rules are untouched by any budget, and the switch is never silent.

**A deployment-wide Spend Breaker sheds in a fixed order.** Background
extraction and embeddings first, scheduled workflows second, interactive Eve
last. Reminder delivery is never shed. The order is fixed so that the cheapest
work to defer goes first and the promise that reminders resurface is kept even
on a bad day.

**The fair-use ceiling sits where the heavy Representative Month is still
profitable.** No admitted account inside fair use may be loss-making.

## Consequences

The ledger cannot answer "what did this account ask Eve", by design. Support
and abuse investigation read tokens and counts, not content.

A fallback model is a second model in production, so it needs its own policy
evidence and its own line in the evidence bundles. Model-comparison evals gain
a concrete consumer.

Throttling is tested alongside the mode table, like disclosure under ADR 0227:
a budget state must not make a forbidden tool reachable or a permitted one
unreachable.

The shedding order means a runaway day degrades Suggested Memories and briefs
before it degrades a conversation, and never a reminder. Recovery republishes
the deferred work when the breaker resets.

References: #568,
[ADR 0070](0070-product-rate-limits-are-separate-from-auth-limits.md),
[ADR 0128](0128-phase-3-uses-explicit-eve-modes.md),
[ADR 0226](0226-hosted-tendnote-is-us-only-and-has-no-free-tier.md),
[ADR 0227](0227-eve-interactive-tool-surface-uses-progressive-disclosure.md),
[ADR 0242](0242-activation-milestones-are-content-free-and-product-owned.md),
[the decision artifact](../phase-9b/cost-and-reliability-evidence.md).
