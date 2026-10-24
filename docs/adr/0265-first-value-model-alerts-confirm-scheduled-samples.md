# ADR 0265: First Value model alerts confirm scheduled samples

Status: Accepted by the owner on October 24, 2026.

## Context

The October 23 investigation retained nineteen scheduled samples from 20:00 to
23:00 UTC: fourteen passed on the first attempt, three passed after a generation
deadline and retry, and two exhausted the 32-second model budget. Each terminal
failure immediately alerted and the next ten-minute sample sent recovery. Two
attempts inside one sample were being presented alongside this repeated paging,
although they do not constitute two independent scheduled checks. Customer impact
and the upstream cause remain unverified.

## Decision

This supersedes ADR 0263's immediate alerting for recognized transient model-only
failures. Keep the 15-second attempt limit, 32-second total budget, three-call cap,
SDK retry settings, usage-persistence safeguards, and all attempt diagnostics.

Two consecutive failed ten-minute slots, or three failures in six scheduled slots,
open the availability episode. Only gateway-generation deadlines and explicitly
retryable HTTP 408/429/500/502/503/504 failures qualify. Authentication,
configuration, usage-ledger, unclassified failures and other First Value steps
still report immediately. Two adjacent clean first-attempt samples close an
incident. Retry-recovered passes, unknown or disabled readings, stale/future
results and gaps cannot confirm recovery. Older/duplicate slot completions cannot
advance counters. Fresh serious evidence can escalate a racing same-slot success,
without counting a second check. Stale means more than five minutes from check start to policy read,
matching the cron's maximum execution allowance.

Confirmed recovery advances a durable incident-confirmation boundary. A subsequent
incident needs new failures after that boundary, including for its first-failure
timestamp. The full six-slot degradation history remains available for summaries;
two clean slots while no incident is open do not discard unconfirmed failures.

Three degraded samples (terminal transient failures plus retry-recovered passes)
in six slots produce one low-priority summary, at most once per six hours, while
no availability episode is open. Summaries close silently rather than generating
another recovery message. Their counts and confirming timestamp persist with the
episode for redelivery. The daily grounded-answer indicator and all other
operator conditions retain their independent behavior.

Persist a bounded six-slot window and summary rate limit in `first_value_health`.
Lock its singleton row and update the window and episodes in one transaction.
Existing episodes are honored when the state is first populated. A policy-write
failure holds this indicator and logs its error class while other conditions and
pending notices continue. This adds migration `0105_first_value_health`; apply it
before activating the new app, with no production migration during PR review.

## Consequences

- Sustained transient model failures take about ten minutes longer to confirm;
  worst-case detection is roughly twenty minutes plus execution. Alternating
  failures still trigger the three-of-six rule.
- Isolated failed samples remain in logs and contribute to summaries, without
  an urgent alert/recovery pair. This changes notification policy, not model
  availability, and adds no model calls.
- The first six slots warm the new window without fabricating historical reads.
  An existing incident needs two clean slots to recover after rollout.
- The additive schema can remain if the app is rolled back. The previous app's
  First Value notification behavior returns; revert/close any summary episode
  deliberately if rolling back while its delivery is pending.
- An independent stale-monitor watchdog, a daily digest, and finer transport
  diagnostics are deferred. An in-app cron cannot detect its own absence.
- Postgres contract tests exercise duplicate/concurrent completions, restart,
  ordering, gaps, unknown/stale data, rollback, summary rate limiting and recovery
  against isolated loopback test databases. CI runs them in the database lane.
