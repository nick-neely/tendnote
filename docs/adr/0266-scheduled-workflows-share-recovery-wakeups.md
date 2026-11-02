# Scheduled workflows share recovery wake-ups

The Eve scheduled-workflow dispatcher runs every ten minutes, matching the web
recovery cron's UTC ticks. Previously the ten-minute recovery and fifteen-minute
dispatcher schedules woke the database at eight distinct times per hour. Aligning
them gives six distinct times, leaving quiet intervals for Neon's five-minute
autosuspend without relaxing recovery, reminder, deletion, or monitoring cadence.
This follows ADR 0066's app-owned schedule rows; it does not replace them with
per-owner cron definitions or a new workflow service.

## Delivery and retries

Normal scheduled work is checked every ten minutes instead of fifteen. Owner
timing is still quantized to the next tick: an occurrence due at :15 previously
ran on that tick and now runs at :20, so individual timings can be five minutes
later even though the maximum normal dispatch wait decreases. Owner
admission, usage pauses, due-row claims, local-date idempotency, and delivery
deduplication stay authoritative. Background queue delivery is unchanged. The
dispatcher still does no generation for a future or disabled schedule.

Failed briefs and birthday planning retain five attempts. The scheduled entry
point supplies a fifteen-minute minimum interval from each attempt's own start,
after earlier rows and owner checks; explicit logical `now` callers remain fixed.
Release stores the retry hold in the existing `lease_expires_at`.
Claiming already excludes a live lease,
so duplicate ticks and a new invocation cannot spend another attempt early. The
original `next_run_at` remains unchanged during the hold, preserving the local
date of the occurrence. Success, usage-paused roll-forward, and final failure
clear the hold and reset attempts as before. Other callers retain the existing
retry-on-next-tick default unless they explicitly supply a delay.

At regular ten-minute ticks, that hold makes failed attempts normally occur at
minutes 0, 20, 40, 60, and 80. This extends the previous roughly sixty-minute
five-attempt window to roughly eighty minutes, rather than shortening it to
forty or buying more attempts. A successful retry may wait five minutes longer
than the old fifteen-minute cadence. Execution time, missed ticks, and platform
jitter can extend those windows. No schema migration is needed.

## Cost and limits

An otherwise idle database with instantaneous checks and five-minute autosuspend
has a modeled awake baseline of sixteen hours per day before alignment and
twelve afterward. At 0.25 CU and $0.106/CU-hour, thirty days cost $12.72 versus
$9.54 in compute alone. If the last query is one minute after each tick, the
modeled saving is $2.54 instead of $3.18. These are scenarios, not measured
savings: user activity, invocation jitter, and the actual last query matter.

Dispatcher invocations increase from four to six per hour, including owner and
Calendar checks. Daily and per-occurrence gates prevent that from becoming
duplicate successful delivery, but API and runtime overhead can consume savings.
Compare quiet-day active hours/CU-hours and dispatch/API counts after deployment;
revert if the measured tradeoff is unfavorable. Busy workloads may save little.

Simply slowing recovery is unsafe. Reminder outbox rows currently wait for its
due-row scan before publication, and ADR 0265's confirmation state machine uses
ten-minute slots. A future delayed-publication change must address revisions,
queue retention, recovery, and those monitoring assumptions before revisiting
the cadence. Retention sweeps must continue to meet their published deadlines.
The delayed-publication follow-up is tracked in
[issue 759](https://github.com/nick-neely/tendnote/issues/759).

## Verification and rollback

Tests assert shared cadence, dormant dispatch behavior, owner isolation, usage
pauses, failure isolation, due/future/disabled rows, duplicate ticks, successful
retries, and the unchanged five-attempt budget across persisted retry holds.

Rollback restores the dispatcher to fifteen minutes and removes its retry-delay
options together. Existing holds expire naturally within fifteen minutes. The
optional store/dispatcher support is additive and can remain without affecting
callers that omit it. Revisit costs and throughput before paid launch, as active
owners or connected calendars grow, or if dispatch time approaches the interval.
