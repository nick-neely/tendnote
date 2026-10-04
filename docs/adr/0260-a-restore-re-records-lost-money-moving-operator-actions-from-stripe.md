# ADR 0260: A restore re-records lost money-moving Operator Actions from Stripe

Status: Accepted in the October 4, 2026 implementation of issue #723.

## Context

Every Operator Action writes its record, journals it to the Recovery Journal,
and only then calls Stripe
([ADR 0248](0248-admission-exceptions-live-inside-their-condition.md),
[ADR 0249](0249-refund-revocation-is-matched-to-its-operator-action-record.md)).
A restore rolls the records back but not the journal or Stripe, so the restore
step `reconcile-admission` lists each journaled action the restored data no
longer holds. A journal record is content-free: kind, account, action id, time.

Some actions are safe to run again; others are not. Running a refund again
opens a new record, whose new idempotency key asks Stripe to refund again. A
lift or termination run again issues its Suspension Credit again under a new
id, which the credit-note lookup cannot match. A termination run again also
takes the current time, moving its retention deadline. Left unrecorded, a
refund raises the unmatched-refund alert on every reconciliation pass, and a
terminated account comes back open.

## Decision

**Stripe objects carry the record they were made for.** A Refund's Stripe
refund carries the record id, invoice, and subscription in its metadata. A
Suspension Credit's credit note carries every field of its record that the
note does not already hold.

**`reconcile-admission` re-records what cannot be run again, before its Stripe
replay.** Each missing termination, suspension lift, refund, and Suspension
Credit is written under the journal's own action id and time, with no Stripe
write:

- A termination from the journal alone. Its retention deadline runs from the
  journal time, and its reason says it was re-recorded, since the journal holds
  none.
- A lift onto the suspension the action id names, if that suspension is still
  open.
- A refund or Suspension Credit from the Stripe object carrying its record.

Keeping the journal's id is what makes this safe. The action leaves the missing
list, the replay matches a re-recorded refund by its Stripe id instead of
alerting on it, and the email fences copied in from production, keyed by
record id, hold back the confirmation the replay would otherwise send again.

Re-recording from Stripe alone was rejected because no Stripe object carries a
termination. A restore-only mode on each operator command was rejected because
it adds a second path to every money-moving command.

## Consequences

- A refund or credit note made before this decision carries no record, so its
  action stays listed for the operator, as before.
- A lift whose suspension the restore re-created under a new id cannot be
  matched, and stays a hand-run update in the runbook.
- A re-recorded termination's original reason lives only in the Incident
  Record.
- Kinds that move no money (suspension, grant, ceiling override) are still
  re-run by the operator, as the runbook says.
