# Background and Web-Search Ceilings Pause Where the Spend Happens

The Account Ceiling has two more categories than interactive Eve: background
work at $1.30 and web search at $0.70 (spec #591, ADR 0246). Neither has one
door to guard. Background calls come from four job families, the schedule,
snapshots, summaries, ranking, and search's own query embeddings. Web search is
not a model call at all: Eve's `web_search` runs the gateway's Exa search
inside an interactive call, and the gateway's reported `cost` is the inference
cost only, so ADR 0252's rule of counting what the gateway reports cannot see
it.

## Decision

**The entry point refuses a background call at the ceiling.** Before a
background call reaches the model, the model-call entry point reads the
account's spend and throws a `UsagePausedError` naming the reset day. That is
the one guarantee every background caller shares, so overshoot is bounded by
the call already running. A read that fails lets the call go ahead; the Spend
Breaker, not a guess, bounds a read that cannot be made.

**A refused job waits in its pending state until the reset.** Each job family
turns the refusal into a deferral, not a failure: the job goes back to
`pending` with its run-after at the start of the reset day and keeps no error.
A family that dead-letters on attempts hands back the one its claim counted, so
a pause can never dead-letter a capture. The recovery backfill picks it up once
it is due. Callers with a deterministic fallback (snapshots, brief summaries,
ranking, drafts) use it.

**Scheduled workflows skip their next delivery.** The schedule reads each
owner's background notice once per tick. A paused owner's due brief rolls
forward to its next run without generating, and aftercare does not run that
tick. Gift planning and the action summary make no model call and are not shed. Nothing is delivered late or in a reduced form. Reminders
are not scheduled workflows and never pass this check.

**Search is reduced to exact matches.** Query embeddings are charged to the
background allowance, so while background work is paused, search skips Related
matches and says so in its limitations with the reset day.

**Web searches are metered at the gateway's list price.** Each `web_search`
the provider ran inside a call is recorded to the `web_search` category at
$0.007, Exa's price for a request of up to ten results, as it appears in the
response. A `web_search` the model called but no provider ran costs nothing.
At the ceiling, a resolver beside the mode gate rebinds `web_search` to an
inert definition when the turn starts. A read that fails withholds it for that
turn.

## Consequences

Every background caller is covered without each one checking, and only the job
families need to know the error exists. The price of a search is a constant
that must follow the gateway's published Exa price; a change there is a code
change. The web-search pause can only take a tool away, and only for spend, so
it never hands a mode a tool the mode gate forbids. A turn already searching
finishes, so overshoot is one turn's searches. Deferred jobs resume at the
recovery backfill's pace, five per family per ten-minute pass across the
deployment, not all at once; a large backlog on a shared reset day drains over
hours.

References: #627,
[ADR 0246](0246-hosted-inference-is-metered-content-free-and-shed-in-a-fixed-order.md),
[ADR 0252](0252-account-ceilings-count-gateway-reported-cost-at-the-turn-door.md),
[the paid offer](../phase-9b/paid-offer-and-price.md).
