# ADR 0263: Reliability Indicators are read by the recovery cron, and Eve is asked daily

Status: Accepted in the October 4, 2026 implementation of issue #649.

## Context

The [cost and reliability evidence](../phase-9b/cost-and-reliability-evidence.md)
names three Reliability Indicators: First Value path availability, measured by
a synthetic check of landing, checkout, admission, and a grounded Eve answer
every ten minutes; reminder delivery within five minutes of the alert time; and
the oldest pending background delivery under thirty minutes. Each must reach
the operator alert channel
([ADR 0258](0258-operator-alerts-are-condition-episodes-sent-by-email-and-ntfy.md)),
whose conditions are states read on each recovery cron pass. The synthetic
check must use no customer account.

A real Eve turn costs about $0.02 to $0.06: every call carries roughly 55k
input tokens of tool surface
([paid offer and price](../phase-9b/paid-offer-and-price.md)). Asking Eve every
ten minutes would cost about $60 to $180 a month, more than four customers'
whole Account Ceilings, to watch a service with no on-call.

## Decision

**All three indicators are conditions read by the alert pass.** Each pass
reads them directly from the database and the deployment, like the other
conditions, and a read that fails gives no reading, so an open alert holds.

- **Reminder lateness** (`reminder_lateness`) fires while a reminder delivery
  job is more than five minutes past its alert time and still waiting to send,
  and for fifteen minutes after one was accepted late or dropped as stale. Only
  the dispatcher marks a job stale, so a waiting job keeps counting for a day
  past its freshness; otherwise a dispatcher outage would recover the alert an
  hour later with nothing delivered.
  Lateness runs from the later of the alert time and the job's creation, so a
  reminder set for a time already past is not late by construction. A push
  endpoint the push service rejected is not lateness. Reminders are never
  shed, so this condition is never quieted.
- **Background backlog** (`background_backlog`, catalogued in #648) fires
  while any extraction, embedding, or export job is unfinished thirty minutes
  past its `run_after`. That column is when the job was due: its enqueue time,
  its retry time after a failure, or the reset time after an Account Ceiling or
  Spend Breaker deferral. A deliberately deferred job therefore counts only
  once it is due again, and the condition stays quiet while background work is
  shed. It measures lag, not failure: a job failing on a backoff never ages.
  The delivery ledger itself is not read, because a deferred or failing job's
  delivery row reads `published` while the job waits.
- **The First Value path** (`first_value_path`) is walked every pass, as far
  as it goes without a customer account. The marketing landing page must load.
  Both Checkout prices must be active in Stripe; no Checkout session is opened,
  so no Stripe artifact accumulates. A dedicated operator-owned synthetic
  account, admitted by `manual_grant` like the author's own, signs in through
  the deployment's own sign-in route. Eve's inspection route must then accept
  its cookie, which runs the channel's whole auth policy, admission included,
  without a turn, and the route names the model Eve runs. Last, one capped
  call on that model goes through the model-call entry point, metered to that
  account. The step retries it at most twice, two then four seconds apart,
  while the gateway calls the error retryable, all inside one 15-second
  deadline, and logs every attempt whether it passes or fails (#745). The pass
  then signs out.
- **The grounded Eve answer** (`grounded_eve_answer`) is asked on one pass a
  day: the first at or after 15:00 UTC (9:00 or 10:00 Central, inside the
  operator's waking hours) whose account Eve admitted. That pass claims the UTC
  day with a Redis `SET NX`, so a late or failed pass is made up by the next
  one and two passes never both pay for a turn. Eve gets a question in a fresh
  session that only the synthetic account's fixture Memory answers, and the
  reply must contain the fixture's answer. The other passes give no reading,
  so a failed answer holds its alert until the next day's answer or an
  on-demand run passes. It is a separate condition so that a passing cheap
  pass cannot send a false recovery for it. It is quiet while interactive work
  is shed, because Eve then refuses new turns by design and the Spend Breaker
  alert already covers it. The cheap steps are not quieted: the model-call
  entry point and Eve's inspection route both keep working while interactive
  work is shed, so a failure there is a real outage. The check is
off unless the deployment is hosted and `TENDNOTE_SYNTHETIC_CHECK_EMAIL` and
`TENDNOTE_SYNTHETIC_CHECK_PASSWORD` are set. The same check runs on demand as
`pnpm --filter @tendnote/web first-value-check [--grounded]`.

## Consequences

- The synthetic check costs about one token of model output and one sign-in a
  pass, plus one real Eve turn a day, roughly $1 to $2 a month. It is metered
  to the synthetic account like any account's use.
- A harness regression that only a real turn shows, such as a broken tool loop
  or lost grounding, is caught within a day rather than ten minutes. An outage
  of the landing page, Stripe, sign-in, Eve, or the model gateway is still
  caught within one pass.
- The synthetic account is a real hosted account. It records Activation
  Milestones and a Usage Ledger like any other, holds one retired Eve session
  a day, and must re-accept changed Terms, or every pass fails at admission.
- The check runs inside the deployment it watches, so it cannot see the
  deployment or its cron being down. That is the gap the deferred external
  status publication would close
  ([bounded usage](../phase-9b/bounded-usage-and-support-contract.md#status-visibility)).
- Checking the prices does not prove Checkout itself opens. A Stripe outage
  confined to Checkout is not caught.
- After a Spend Breaker day, the work it deferred all comes due at midnight
  and is drained by the backfill at five jobs per family a pass. A family with
  more than about fifteen deferred jobs raises the backlog alert shortly after
  midnight, once the breaker has closed and no longer quiets it. That is real
  lag, so it alerts; it recovers as the backfill drains.
- A restore's Outbound Pause or a Service-Wide Hold stops every cron pass, so
  no indicator is read and nothing alerts while one holds. The first passes
  after the lift report the reminder lateness and backlog it caused, which is
  real, and recover as the work drains.
- Neither the reminder nor the backlog query has an index of its own. Both
  scan small tables at launch scale; an index is added if either grows.

## Alternatives considered

**A real Eve turn every ten minutes, as specified.** Rejected for its cost,
which is above.

**No real Eve turn.** Rejected: the inspection route and a model ping cannot
show that Eve still finds and answers from what the account said, which is the
First Value step most likely to regress silently.

**Opening and expiring a real Checkout session each pass.** Rejected because
it leaves about 4,300 expired sessions a month in the Stripe dashboard to prove
one more hop.
