# The Spend Breaker Sheds in Stages Past Its Daily Ceiling

ADR 0246 fixed the Spend Breaker's order: background extraction and
embeddings first, scheduled workflows second, interactive Eve last, and never
reminders. The production-models decision fixed its daily ceiling at
2 x (admitted accounts x $14.00 / 30) + $5.00, recomputed daily. Neither said
what moves the breaker from one stage to the next, where it reads spend, or
what records a trip. One ceiling and an order of three is not yet a mechanism.

## Decision

**Each stage sheds at a further multiple of the day's ceiling.** Crossing the
ceiling trips the breaker and sheds background work. Scheduled workflows shed
at 1.25 times it, and interactive Eve at 1.5 times it. A runaway that the first
stage stops never reaches the second, so a background loop costs no
conversation; a runaway the first stage cannot touch, such as an interactive
loop, keeps spending and the later stages follow it. The ceiling is already
twice the pace at which every account would spend its whole Account Ceiling,
so even the first stage fires only when metering has gone wrong, never on
growth. The multiples are cheap to revise.

**The ceiling holds for one UTC day.** The day's first read opens a row in
`spend_breaker_days` with the ceiling computed from the accounts admitted
then (`access_profiles.status = granted`), and the ceiling holds until UTC
midnight, matching the Usage Ledger's days. Spend is the sum of every account's
`cost_micro_usd` for the day, operator and Household included. At midnight the
next day opens closed under a fresh ceiling; that is the reset.

**The breaker folds into the usage reads every function already makes.**
`readUsageNotices` reads the account's period spend and the breaker's stage
together, and a shed function's notice is paused, or reduced for search, with
the recovery condition "Resumes when service is restored" and no date. Each
existing door then enforces it unchanged: the model-call entry point refuses a
background call and the job waits in `pending` until the next UTC midnight;
the schedule skips a delivery when the new `scheduled` notice is paused; Eve's
door refuses a new turn. A background call names which work it is, so a
brief's summary is read against the `scheduled` notice and is shed with its
delivery, not with capture processing. A breaker that cannot be read counts as
closed and logs `spend_breaker.read_failed`, so it never takes the account's
own ceilings down with it. The breaker never changes the model and never reaches the mode
gate, approval gates, or egress rules. Reminder delivery reads no usage notice
at all.

**A trip is a row and a log line.** The first read to see a stage stamps that
stage's column on the day's row, and only the read whose update stamped it
logs `spend_breaker.shed` with the day, stage, spend, ceiling, and admitted
accounts, so each stage alerts once a day however many readers race. That log
is the record the operator alert channel reads, as
`stripe_reconciliation.failed` is.

**Hosted only.** A self-hosted deployment has no plan to derive a ceiling
from, so its breaker stays closed and reads nothing.

## Consequences

Every metered read now also reads today's breaker row and sums today's ledger
across the deployment, which the ledger's `day` index serves. The worst day is
bounded by 1.5 times the ceiling plus the turns and calls already running when
Eve sheds.

The breaker counts what the ledger counts. A call the gateway reported no cost
for is recorded as free and logged, so it moves neither an Account Ceiling nor
the breaker; that warning, not the breaker, is how a missing cost report
shows.

Deferred work resumes at the recovery backfill's pace once the next day opens,
as it does after a Usage Period reset. If the runaway is still running, the
new day trips again. Nothing records the breaker closing: a day's row with
stamped stages is the trip, and the next day's row is the recovery, which the
alert channel reads when it is built.

References: #628,
[ADR 0246](0246-hosted-inference-is-metered-content-free-and-shed-in-a-fixed-order.md),
[ADR 0252](0252-account-ceilings-count-gateway-reported-cost-at-the-turn-door.md),
[ADR 0254](0254-background-and-web-search-ceilings-pause-where-the-spend-happens.md),
[the breaker ceiling](../phase-9b/production-and-fallback-models.md).
