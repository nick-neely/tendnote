# ADR 0260: A Legal Hold covers an account and pauses only its purge

Status: Accepted in the October 4, 2026 implementation of issue #632.

## Context

[ADR 0248](0248-admission-exceptions-live-inside-their-condition.md) says a
Legal Hold names the data it covers and blocks only that deletion. The Operator
Action table records it as a hold record naming the data and its expiry, and
the deletion-notice runbook says a hold pauses the sequence for the data it
covers. None of these say how finely a hold names its data.

Tendnote has three irreversible purges: an owner's own account deletion, the
retention-deadline purge of a Lapsed or Terminated account, and the household
purge. Each removes a whole subject in the Recovery Journal's order of intent,
Deletion Record, then delete
([ADR 0250](0250-one-backup-window-bounds-recovery-and-the-deletion-tail.md)).
An account deletion removes the account row, and the database's
household-aware disposition decides what goes and what stays with a Household.
No path deletes some of an account's data and keeps the rest.

## Decision

**A hold names an account and an expiry.** `operator legal-hold <user id>
<YYYY-MM-DD>` writes a `legal_holds` row, then journals it as a `legal-hold`
record. The hold ends when that date begins in UTC. A hold cannot be shortened.
A later expiry is a second record, and the latest expiry governs.

**It blocks the account's purge and nothing else.** Admission, export, billing,
and the request to delete are unchanged:

- An owner's deletion request still commits its intent, so the account closes,
  sessions end, and billing stops. The purge stops before the Deletion Record
  is written. A restore must never re-apply a record for held data. The
  recovery sweep leaves the intent alone until the hold ends, then finishes
  it. The stuck-intent alert counts its twenty-four hours from the hold's
  end.
- A Lapsed or Terminated account under a hold is owed nothing by the retention
  sweep: no notice and no purge claim. When the hold ends, the sequence
  resumes from the stage it reached. Notices still owed before the deadline go
  out. If the deadline passed during the hold, the next pass purges the
  account and sends the usual confirmation.
- While a hold covers the account, the Lapsed and Terminated areas give no
  deletion date. They do not name the hold.

Each check sits at the last safe point as well as in the listing query. A hold
placed after a sweep listed the account still stops the purge. The check is not
in the same statement as the row delete. A hold placed in the moment between
the check and the delete does not stop that purge, which an operator placing a
hold by hand will not meet in practice.

## Considered options

**Name individual records.** Rejected. Holding some of an account's records
while purging the rest needs a partial purge, and the deletion design has none.
Every record's foreign keys reach the account row, so the only way to keep a
held record is to keep the account. A finer name would block exactly what an
account-level hold blocks, with more to record and verify.

**Block an owner's routine record edits and deletions as well.** Rejected. The
Operator Action blocks the purge, which is the irreversible deletion an
operator controls. Blocking every delete path in every domain would change
ordinary product behavior across the app for a rare operator need. That is not
the deletion ADR 0248 describes.

**Refuse the owner's deletion request while held.** Rejected. CONTEXT.md says
a hold blocks the deletion and nothing else about the account's exit. Refusing
the request would also leave the account open and billing.

**Let a hold name a Household.** Deferred. A household purge is the other
deletion subject, but no requirement asks to hold one. A journal record names
an account, so a household hold would need its own record shape. Add it when a
real need appears.

## Consequences

- Covered data stays until the hold expires. Other accounts, and a held
  account's admission, export, billing, and exit, are unaffected.
- A Deletion Record journaled before a hold was placed is still re-applied by a
  restore. That needs a deletion whose journal write succeeded but whose delete
  failed, then a hold, then a restore within the Backup Window. The restore
  runbook lists a missing `legal-hold` record for the operator to re-place.
- The deletion screen's promise that records are deleted now is untrue for a
  held account. How the Privacy Policy states legal retention is a counsel
  item, not product copy.
