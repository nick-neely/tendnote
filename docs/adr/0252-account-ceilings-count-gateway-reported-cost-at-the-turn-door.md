# Account Ceilings Count Gateway-Reported Cost at the Turn Door

The Account Ceiling is a dollar amount per Usage Period (ADR 0246, spec #591),
but the Usage Ledger recorded only tokens. About nine in ten input tokens in a
Representative Month are cache reads billed at a tenth of the input rate, so a
token count priced from a rate table would pause an account several times too
early, and the table would drift every time a gateway list price moved. The
baseline cost replay already priced calls from the gateway's own report.

Interactive Eve also has more than one place a limit could bite: inside the
model-call entry point, which sees every call of a turn, or at the Eve route
where a turn starts.

## Decision

**The ledger records what the gateway charged.** Each metered call adds the
gateway's reported cost (`providerMetadata.gateway.cost`) to its daily row, in
millionths of a dollar. Ceilings sum that column over the Usage Period. A call
with no usable reported cost is counted as free and logged; bounding a metering
failure is the Spend Breaker's job, not a guess's.

**The interactive ceiling is enforced where a turn starts.** A guard around
Eve's route auth refuses a new conversation or message while the account is
paused, with a 403 carrying the notice. A turn already running finishes, its
approvals can still be answered, and streams and cancels are untouched, so a
ceiling never strands a half-finished turn. Overshoot is bounded by one turn.
A usage read that fails refuses the turn, as a failed admission read does.

**The Usage Period anchor is the subscription's start.** It is written from
each subscription's first paid invoice onto the Access Profile, so annual and
monthly subscribers reset monthly on the same day, and a resubscription
re-anchors. An account with no anchor has no plan and no plan-derived ceiling.
A first invoice whose account has no Access Profile to anchor fails, so Stripe
redelivers it rather than leaving a paying account without a ceiling.

## Consequences

The ceiling follows the gateway's prices without a table to maintain, and
stays content-free: cost joins tokens and counts as an aggregate. The guard
decides only whether a turn may start and passes the principal on unchanged,
so the mode gate, approval gates, and egress rules see no difference under any
limit. Scheduled Eve runs do not come through the route, so this guard never
skips a delivery; pacing them belongs to the background ceiling and the Spend
Breaker.
