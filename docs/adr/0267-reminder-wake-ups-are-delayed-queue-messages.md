# Reminder wake-ups are delayed queue messages

A Reminder delivery job used to wait in the outbox until the ten-minute
recovery cron found it due, so an alert due just after a tick could wait almost
ten minutes for its queue message. That is a source-derived risk against the
five-minute reminder Reliability Indicator (ADR 0263), not an observed incident.
Now a reminder's wake-up is published to Vercel Queue as soon as it is
scheduled, delayed to the alert time. Postgres stays the authority on every
reminder, job and retry (ADR 0068); the message is only a pointer that wakes the
consumer, which reloads the job and decides again before anything is sent.

## Publication

Arming a delivery writes the outbox row first and publishes only after the
surrounding transaction commits (`runAfterDatabaseCommit`). A failed or uncertain
send never fails the owner's mutation: it leaves a `pending` or `publish_failed`
revision that the recovery cron publishes, under the same idempotency key, so a
send that was in fact accepted is not duplicated inside the provider's
deduplication window. A current pointer that arrives before its `published`
write lands is processed rather than dropped.

Reminder scheduling runs deep inside shared general action, Follow-Up, Saved
Item and capture mutations that both runtimes call, so no caller can hand it a
transport. Each runtime registers its signed adapter once at startup instead -
web from `instrumentation.ts`, Eve from a hook - through a `globalThis` registry
in `@tendnote/db`, which still never imports `@vercel/queue`. Unregistered, a
runtime behaves as before: the cron publishes.

This narrows ADR 0068 for reminders only. That ADR has the runtime edge
compose "create the job, then publish". Here the runtime still owns and
supplies the transport and its credentials, but the shared reminder module
decides when to publish, because only it knows a schedule changed. Every other
job family still publishes from its runtime edge as before.

Publishing is internal transport, so it is not held by an Outbound Pause or a
Service-Wide Hold; delivery is. Every callback refuses while either is in force
and the message is redelivered, or, if it expires first, recovered as below.

## Revisions

Every re-arm - a new job, an edit, a deferral, a retry, a reinstall, a
checkpoint hop - bumps the outbox row's `revision`. The pointer carries it,
authenticated by a second HMAC (`revisionSig`) beside the original tag, and its
idempotency key ends in `:r<revision>`. Without that, an edit or a retry inside
the provider's 24-hour deduplication window reused the first message's key and
was silently never sent; that latent retry bug is fixed by the same change.
A pointer whose revision is not the row's current one returns without any
write, so an old callback can neither process nor disturb a newer revision. A
status write from a slow publish is fenced to the revision it sent, and a
publish that runs after a newer revision was armed sends nothing, since its
delivery time is out of date. One-shot
families never re-arm, stay at revision zero, and keep byte-identical payloads
and keys.

Revisions protect the transport; the job protects the outcome. Dispatch still
reloads the record, schedule, installation, opt-in and subscription, and still
enforces occurrence and installation deduplication, Reminder Freshness Windows,
attempt budgets, Outbound Pause and Service-Wide Hold. A pointer held past its
freshness suppresses only that one stale alert. Reminders remain outside the
restore Effect Fence and are not shed at usage ceilings.

## Retention, horizon and checkpoints

The provider caps both delay and retention at seven days, retention runs from
the send, and delay may not exceed retention. Each scheduled message is retained
for 24 hours past its delivery time, so consumer retries through a hold, a pause,
a rate limit or a crash still find it. That fixes the longest single delay at six
days. A reminder due later is published as a checkpoint at that horizon: the
consumer finds the job not yet due, re-arms the next hop from current state, and
acknowledges. A pointer that arrives early for any other reason (a retry not yet
due, clock skew) takes the same path, so no message is ever dropped while it is
the job's only wake-up.

## Recovery stays

The cron is kept, at its existing cadence, as the safety net. It publishes any
unpublished revision against the job's current due time, abandons rows whose job
has completed or been skipped, and re-arms up to 25 jobs per pass whose wake-up
is lost: due more than five minutes ago with no row, an abandoned row, or a
pointer published more than five minutes ago. That covers provider outages,
messages that expired during a long hold, crashes between commit and send, and
rollback leftovers. A `running` claim older than five minutes belongs to a dead
process and may be taken over; the push tag keeps a repeated notification to one
on the device. An overdue job whose freshness has already passed is closed as
stale by the sweep itself (conditionally, so an edit that lands meanwhile wins)
rather than woken again, which also bounds a job
whose dispatch keeps failing: it is retried only until its freshness ends.

This change does not slow the cron or any synthetic, backup-surface, retention
or deletion schedule. ADR 0265's First Value confirmation assumes ten-minute
samples, and ADR 0266 notes that slowing recovery alone is unsafe. Any cadence
change is a separate decision that needs its own expectations, transition and
rollback tests, and measured quiet- and active-period comparisons of Neon
CU-hours, queue operations, function compute, API calls, reminder lateness and
backlog. No cost saving is claimed here; each reminder now costs one send and one
callback, plus one hop per six days of lead time.

## Evidence

The consumer logs `reminder_delivery.dispatched` with the outcome, the queue
lag, the attempt count and, for an accepted send, the seconds from alert time
to provider acceptance, and
`reminder_delivery.checkpoint` when it re-arms early; recovery logs
`reminder_delivery.lost_wakeups_rearmed` with counts. None carries content or
owner identifiers. Provider acceptance is not display on the device. The
five-minute Reliability Indicator remains the rollout acceptance target.

## Rollback

`REMINDER_DELIVERY_PUBLISH_AHEAD=off`, set identically on web and Eve, restores
cron-only publication without a deploy of older code: every re-arm, including
consumer checkpoints and recovery, waits in the outbox until due, and pointers
already in flight still resolve or no-op safely.

To deploy code that predates this change, set the switch off first, then run
`pnpm --filter @tendnote/db db:reminder-wakeups:rollback` twice, at least five
minutes apart, and then deploy. Older code publishes only pending rows that are
due, drops early pointers and never reclaims a `running` job, so the reset
returns every live reminder delivery to a pending row due with its job and
turns any claim whose lease has expired into a retry due now; the second run
catches claims that were still live during the first. It also bumps each
revision, which fences out any publish still in flight so it cannot mark the
reset row `published` again, and means rolling forward later never reuses an
idempotency key the provider may still be deduplicating. The pointers older
code publishes carry no revision and no-op after a roll-forward; the
lost-wake-up sweep re-arms those jobs, so a reminder due in that window can be
up to one pass plus the five-minute grace late.
