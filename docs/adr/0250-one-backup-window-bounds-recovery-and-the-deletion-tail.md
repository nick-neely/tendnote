# One Backup Window Bounds Recovery and the Deletion Tail

Hosted Tendnote had two draft promises about the same database history. The
privacy draft said deleted account data is gone from backups within one day.
The support draft proposed a verified seven-day recovery window. Neon restores
from its history, so anything restorable is still a backup copy: a seven-day
recovery window keeps deleted rows for seven days. The two numbers cannot both
be true.

Neon also keeps data outside the history window. Scheduled snapshots last up to
35 days, and manual snapshots and `_old_` restore branches never expire unless
someone deletes them. Any of them would quietly outlive whatever deletion tail
Tendnote publishes.

## Decision

**One Backup Window, seven days, bounds both the recovery window and the
deletion tail.** It is one named domain constant. The Neon history window is
configured to it on Launch, whose maximum it is, and public copy is generated
from it.

**No retained surface may outlive the window.** There are no scheduled
snapshots. Manual snapshots carry an expiry inside the window. Restore backup
branches are deleted after verification, and never later than one window after
the restore. A scripted check flags violations, and a violation is a Suspected
Incident.

**A restore never brings deleted data back.** Every irreversible purge
(account deletion, the Lapsed purge, and the household purge) writes a
content-free Deletion Record to the Recovery Journal before it deletes.
Recovery re-applies those records. Deletion Record Retention is thirty days,
derived from the window plus a detection margin.

## Consequences

The deletion tail cannot silently drift. Raising it would take a Neon plan
change and a change to the constant, both of which are reviewed.

Recovery is limited to seven days. Corruption noticed later than that is not
recoverable from Tendnote's own backups. Point-in-time restore is the only
recovery tool, so a long-lived snapshot can never serve as an emergency
archive.

Adding any backup surface, such as scheduled `pg_dump` exports, reopens this
decision and the retention values derived from it.

The telemetry provider's own seven-day snapshots are disclosed separately. They
are not governed by this constant.

## Alternatives considered

**Keep the one-day deletion promise and a one-day recovery window.** Rejected
because a solo operator who notices corruption after a weekend could not
recover.

**Allow 35-day scheduled snapshots and publish a longer tail.** Rejected
because it extends the life of deleted content five-fold for a recovery depth
that a one-person service is unlikely to drill or use. It would also stretch
Deletion Record Retention to ninety days.

**Separate recovery and deletion numbers.** Rejected because recovery comes
from the same history that holds the deleted rows. The only way to keep the
numbers apart is a second backup system, which is a new surface to bound, not
a simplification.
