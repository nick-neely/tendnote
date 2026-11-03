# ADR 0269: Prelaunch background passes run hourly

Status: Accepted in the November 3, 2026 implementation of issue #764. Prelaunch
only: restore the ten-minute cadence before paid launch.

## Context

Two scheduled entry points share one database: the web recovery cron
(`/api/cron/background-jobs`) and Eve's scheduled-workflow dispatcher. Both
read Postgres on every tick, before they know whether anything is due: the
recovery pass starts with the Outbound Pause and Service-Wide Hold reads, and
the dispatcher with the admitted-owner list. A read that finds nothing still
resumes a suspended Neon compute, which then stays up for the five-minute
autosuspend tail. Fewer statements per tick therefore save nothing; only fewer
ticks that touch Postgres do.

A content-free read of the production project's compute start and suspend
operations measured that floor:

- **Before ADR 0266 (October 30 to November 2, about 92 hours).** The compute
  was awake 77% of the time, and 76% overnight (06:00-12:00 UTC), so owner
  activity barely registered. The dispatcher still fired at :00, :15, :30 and
  :45; its :15 and :45 runs kept the compute up until about fifteen seconds
  before the next recovery tick woke it again.
- **After ADR 0266 (three hours on November 2-3).** Both entry points fire on
  the same ten-minute ticks. An idle tick wakes the compute at about :x0:12,
  its last statement lands about a minute later, and the compute suspends at
  about :x6:01: roughly 5.8 awake minutes per pass, a 58% idle floor, and 67%
  with other traffic included. The sample is short; a full quiet day confirms
  it.

At 0.25 CU and $0.106 per CU-hour, a 58% floor is about $11 of compute every
thirty days. Hourly passes at the same 5.8 minutes each are about 2.3 awake
hours a day, about $1.85. These are list-price scenarios from measured awake
time, not invoices.

ADR 0266 and ADR 0267 kept the ten-minute cadence because ADR 0265's First
Value confirmation needed ten-minute samples. ADR 0268 moved that check to a
daily policy for prelaunch, which removed the last rule that read a slower
pass as a gap. Tendnote has one owner and no paying customer.

## Decision

**Both entry points run hourly, on the hour.** `BACKGROUND_PASS_CRON` in
`packages/domain/src/background-pass.ts` is `0 * * * *`, and
`BACKGROUND_PASS_INTERVAL_MS` is one hour. The web cron in `apps/web/vercel.json`
and the dispatcher's `defineSchedule` keep literal cron strings, because each
platform reads its own statically; tests hold both to the constant, so they
cannot drift apart and lose the shared wake-up ADR 0266 bought. A test also
refuses `FIRST_VALUE_POLICY = "ten_minute"` with anything but ten-minute
passes, because ADR 0265's slots would read every missing pass as a gap.

**Ordinary work still does not wait for a pass.** A job publishes to the queue
when it is enqueued, and a reminder's wake-up is a delayed queue message for
its alert time (ADR 0267). The pass is a repair and housekeeping path. The
default brief, weekly review and birthday-planning times (08:00, Monday 08:00
and 09:00 in the configured timezone) fall on the hour, and no product surface
sets another time, so in a whole-hour timezone they run at the same minute as
before.

**What the slower pass changes, deliberately:**

| Work | Ten-minute cadence | Hourly cadence |
| --- | --- | --- |
| Lost reminder wake-up re-armed (provider outage, crash between commit and send) | 5 to 15 minutes late | 5 to 65 minutes late; an instant reminder (one-hour freshness) can be closed as stale instead of delivered |
| Failed extraction, embedding, action, Context Fact or export job retried | Next pass after its five-minute backoff | Next hourly pass |
| Spend Breaker or Account Ceiling deferral drained | 5 jobs per family per pass | 30 per family per pass, inside a 120-second claim budget |
| Account deletion whose request-time journal or disposition failed | Retried every ten minutes | Retried hourly; the 24-hour stuck alert is unchanged |
| Household purge, retention notices and purges, audit and telemetry retention | Deadlines in days, checked every ten minutes | Up to an hour later against the same deadlines |
| Stripe dropped-webhook repair and the seven-day dunning close | Next pass | Up to an hour |
| Operator conditions (backlog, reminder lateness, stuck deletion, backup surfaces, Spend Breaker) | Read every ten minutes | Read hourly; thresholds unchanged |
| Brief and birthday retries (five attempts, fifteen-minute hold) | About 0/20/40/60/80 minutes | About 0/60/120/180/240 minutes |
| Post-meeting aftercare suggestions | Within ten minutes of a meeting ending | Within an hour |
| Daily First Value check (ADR 0268) | First pass at or after 15:00 UTC; confirmation ten minutes later | Same pass; confirmation an hour later |

**Three fixes keep the slower pass honest:**

- The reminder-lateness condition's lookback (`LATE_REMINDER_LOOKBACK_MS`) was a
  fixed fifteen minutes, a little over one ten-minute pass. Hourly passes would
  never have seen a reminder accepted late between them. It is now one pass
  interval plus five minutes, derived from the cadence.
- The processor backfills claim up to 30 jobs per family a pass, the hourly
  equivalent of five every ten minutes, so a Spend Breaker day still drains in
  the same wall time. Each family stops claiming once 120 seconds of recovery
  have passed, measured from the start of recovery; a job already claimed
  always finishes. That leaves the route's 300-second limit room for the
  stages after it.
- Each stage gets its own attempt. Before, a recovery family that threw
  skipped every family after it, and a failed recovery or sweep skipped the
  remaining sweeps, the operator alerts and the retention deadlines. Now each
  recovery family and each route stage that throws is logged by stage and error
  class, without its message, and the rest still run. The route still answers
  500, so the cron's own failure reporting sees the pass fail. A stage skipped
  by a throw would otherwise wait an hour for its next chance.

## Consequences

- Scheduled wake-ups fall from 144 to 24 a day. The modeled idle compute falls
  from about 14 awake hours a day to about 2.3, about $9 every thirty days at
  list price. Owner traffic, reminder callbacks and other queue deliveries
  wake the database exactly as before.
- Failure-path repair and alert detection are up to an hour slower, as the
  table says. Nothing is dropped: every repair still runs from durable state on
  the next pass, and no deadline or retention constant changes. A published
  promise measured in minutes ("content leaves the live database within
  minutes") is met by the request path, not the pass; only its failure
  fallback slows.
- Rollback is the constants and the two cron literals. This adds no wake-up
  mechanism, so nothing in flight can be orphaned: work the hourly pass has not
  reached yet is picked up by the first ten-minute pass.
- Measure the result with the same read: the Neon operations log's compute
  start and suspend pairs over a quiet day after deployment should show about
  24 scheduled wakes and an awake share near 10% plus other traffic. A saving
  is claimed only from that measurement, and in dollars only from a billing
  period.
- Before paid launch, the cadence returns to ten minutes
  (`BACKGROUND_PASS_CRON = "*/10 * * * *"`, a ten-minute interval, and both cron
  literals) in the same reviewed change as, or before, ADR 0268's
  `FIRST_VALUE_POLICY` restore. The Hosted Obligations Register tracks it. The
  lookback and the backfill limits are sized for an hour and stay correct at
  ten minutes.

## Alternatives considered

**A cheap "anything due?" check each tick.** Rejected: the check is itself a
Postgres read, so it wakes the compute exactly as often.

**Computing each pass's next deadline and waking for it with a delayed queue
message.** Rejected for now: there is no single authoritative next deadline.
Dropped Stripe events, calendar changes and lost wake-ups have no local due
time, so an independent fallback pass is still needed, and the extra saving
over hourly is at most a few dollars a month for a new mechanism with its own
recovery surface.

**A 30-minute cadence.** Viable, at about $7.40 instead of $9.20 saved, with
half the failure-path delay. Rejected because the delays it halves only
matter once customers are admitted, and the cadence is restored before then.

**Slowing only one entry point.** Rejected: the other keeps waking the
database on its own ticks, which is the problem ADR 0266 fixed.

**A shorter Neon autosuspend.** Unavailable: the Launch plan fixes scale to zero
at five minutes; only the Scale plan configures it.
