# ADR 0268: Prelaunch First Value checks run once a day

Status: Accepted in the November 2, 2026 implementation of issue #763. Prelaunch
only: restore the ten-minute policy before paid launch.

## Context

Under ADR 0263 and ADR 0265 the recovery cron walks the synthetic First Value
check on every ten-minute pass: the landing page, the Checkout prices, a
sign-in, Eve's admission route, and one tiny model call capped at 16 output
tokens. One pass a day also asks Eve the grounded fixture question. That is
nominally 144 tiny model probes and one full Eve turn a day, plus up to two
more probe calls whenever a probe is retried. Neither the call count nor the
checked-in model defaults say what is actually billed; that stays unknown
until it is measured.

A content-free read of the production cron logs before this change covered
100 consecutive scheduled samples, from 10:10 UTC on November 2, 2026 to 02:40
UTC on November 3: one every ten-minute pass. 97 were clean on the first
attempt, two passed only after a generation deadline and a retry, and one
exhausted the 32-second budget with two deadline attempts. That is 103 model
attempts. Most single-attempt successes took 0.9 to 4 seconds; five took 6 to
10.6 seconds. Retained logs cover only a day, so this is a sample, not a month.

Tendnote has one owner and no paying customer yet. A synthetic check every ten
minutes protects a path nobody is buying through, and it pages on transient
model failures that no customer felt.

## Decision

`FIRST_VALUE_POLICY` in `packages/domain/src/first-value-daily.ts` selects how
the cron runs the check. It is `daily` until paid launch, and `ten_minute`
restores ADR 0265 unchanged. The constant is the whole switch: there is no
environment variable or production setting, so the policy is in review and in
git history.

**One complete check a day.** The first cron pass at or after 15:00 UTC claims
the UTC day and runs every step, the grounded answer included. The other passes
skip the check and give no First Value sample at all: a skipped pass is not a
healthy reading and holds every episode. The claim is a row-locked update of
the `first_value_health` row, so concurrent passes cannot both run it.

**Missed runs and retries.** A day may claim at most three runs, each with the
model step's existing three-call cap, 15-second attempt limit, 32-second budget,
and no repeated generation once usage persistence starts. A further run is
claimed only:

- to confirm a recognized transient model failure (a generation deadline or a
  retryable 408/429/500/502/503/504), on the next pass;
- to make up a run whose reading was unknown, such as a check that threw;
- to make up a run that never completed, once its 15-minute lease has expired.
  The lease is longer than the cron's 300-second limit, so a live run is never
  doubled.

A pass that misses 15:00 is made up by the next one. A day with no pass after
15:00 has no reading; the next day's run starts a fresh count. The Redis claim
on the grounded answer (ADR 0263) still allows at most one Eve turn a day,
however many runs the day claims. The question is only asked once admission
passes. A day whose run fails at sign-in or admission is settled by that
serious failure, so it asks no grounded question, and the grounded episode
holds until the next day's answer. The `first_value_path` alert already covers
that day.

**Daily state, separate from ADR 0265's window.** Daily results are never
passed into the ten-minute adjacency and six-slot machine. The same locked row
carries a `policy` tag and a daily run ledger: the day, runs claimed, the
claimed run's start time, whether the day is settled, and any transient failure
awaiting confirmation. Only the completion of the run currently claimed, read
within five minutes of its start, is accepted. A stale, duplicate, or
superseded completion changes nothing.

| Completed run | Effect |
| --- | --- |
| Serious (any other failed step, auth, configuration, usage ledger, unclassified) | Opens the incident at once; the day is settled |
| Transient model failure, none pending | Held; the next pass confirms it within the day's runs, or the next day's run does |
| Transient model failure, one pending | Opens the incident, dated from the first failure |
| Retry-recovered | Degraded: dismisses a pending failure, never recovers |
| Clean first attempt, no pending failure | Recovers an open incident |
| Clean first attempt after a pending failure | Dismisses the failure but cannot also recover |
| Unknown | Settles nothing; a later pass may make it up |

A failure therefore stays visible until a genuine later clean check, or until
the operator clears it with the runbook's SQL. The daily policy sends no
`first_value_degradation` summaries: with one sample a day, retry-recovered
checks are visible in `first_value_check.passed` instead. A summary episode
open at the transition stays open and quiet: it has already sent its only
notice, and the next ten-minute summary replaces it. The grounded answer keeps
its independent episode.

**Transitions.** The next claim or completion under a different policy migrates
the row in the same locked transaction. Samples from the other policy are
discarded, not reinterpreted; the summary rate limit is kept; open episodes are
left alone. So an incident open at the transition needs a clean daily check to
recover under `daily`, and two adjacent clean slots under `ten_minute`. Neither
transition can recover an incident by itself. No migration file is needed: the
state is JSON in the existing row. While old and new deployments overlap during
a rollout, their passes can migrate the row back and forth. Each migration
discards the other's samples, so the overlap can cost one extra probe run and
delay a confirmation, but it cannot recover an incident or pay for a second Eve
turn.

**On demand.** After a deployment that touches the First Value path, the
operator runs `pnpm --filter @tendnote/web first-value-check [--grounded]`. It
prints the result and exits nonzero on a failure. It claims no run and changes
no episode or policy state, so it can never consume or multiply the scheduled
check.

**Unchanged.** The recovery cron still runs every ten minutes. Recovery,
deletion and retention work, Stripe reconciliation, the backup-surface check,
the reminder-lateness and backlog indicators, the Spend Breaker condition, and
support-email alerts keep their cadence. Operator alert destinations stay on.

## Consequences

- Scheduled tiny probes fall from about 4,320 to about 30 per 30 days, a 99.3%
  reduction, plus at most two confirmation or make-up runs on a bad day. The
  daily Eve turn is unchanged. These are model-call counts, not dollars saved.
- Detection is slower. An outage of the landing page, Stripe prices, sign-in,
  Eve admission, or the model gateway that starts just after the day's check is
  not seen until the next day's check, almost 24 hours later, or longer if
  that run is missed. A transient model failure is confirmed on the next pass.
- The cron still wakes the database every ten minutes. This change does not
  lower that floor (#764).
- The check still runs inside the deployment it watches. It cannot see its own
  cron or deployment being down, and nothing here is an external uptime
  guarantee.
- The after measurement is the same read once this policy is deployed: about
  one `first_value_check.sampled` line and one model attempt a day, with
  confirmation or make-up runs counted separately.
- Count checks with `first_value_check.sampled`, which logs only the policy and
  the sample's outcome class. Count model attempts and read latency from the
  `attempts` and `elapsedMs` fields of `first_value_check.passed` and
  `first_value_check.failed`.
- Before paid launch, `FIRST_VALUE_POLICY` returns to `ten_minute` in a
  reviewed change, and the operator confirms one passing ten-minute
  confirmation cycle in the logs. The Hosted Obligations Register tracks it.

## Alternatives considered

**Turning the operator alert channel off.** Rejected: it would also silence
deletion, reconciliation, backup, reminder and Spend Breaker alerts.

**Slowing the whole recovery cron.** Out of scope, and it would delay deletion
deadlines and the other conditions that need ten minutes.

**Feeding daily samples into ADR 0265's window.** Rejected: its adjacency and
six-slot rules assume ten-minute slots, so a daily sample would read as a gap
every time.

**An environment-variable switch.** Rejected: it would be a production setting,
and a default that silently outlives launch.
