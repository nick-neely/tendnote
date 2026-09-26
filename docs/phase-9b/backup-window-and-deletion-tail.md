# The Backup Window and the deletion tail

Decision artifact for [Reconcile backup deletion and recovery-window
promises](https://github.com/nick-neely/tendnote/issues/585). It replaces two
conflicting drafts with one promise: the privacy artifact's "gone from backups
within one day" and the support artifact's "verified seven-day recovery
window". It fixes the relationship between immediate live deletion, exclusion
from restored service, and physical backup expiry; bounds every Neon surface
that could resurrect deleted data; sets the Deletion Record and fence
retention values; separates the telemetry provider's backups from Tendnote's;
and takes over the restore drill from
[the runbooks decision](hosted-runbooks-and-tabletop.md).

It is a planning decision. No production retention, Neon plan, or snapshot
setting was changed.

## Facts this decision rests on

- Anything Neon can restore is a backup copy. A recovery window of N days
  means a deleted row survives in history for N days, so "restorable for seven
  days" and "gone from backups within one day" cannot both be true of the same
  history.
- All customer content lives in Postgres, including Asset Evidence bytes and
  Owner Data Export bytes (`bytea` columns in
  `packages/db/src/schema/app/`). Redis holds auth sessions, rate limits,
  invitation budgets, and integration install state, and no content. The Neon
  surfaces are therefore the whole content-backup story.
- Neon has four surfaces that can resurrect data: the history window (Launch
  plan: one day default, seven days maximum), scheduled snapshots (up to 35
  days), manual snapshots (no expiry unless set), and `_old_` restore backup
  branches (no documented expiry)
  ([Recovery Journal mechanics](../research/phase-9b-recovery-journal.md)).
- Production history retention was six hours when last read (2026-09-16),
  which is the Free-plan cap. The price estimate already assumes Neon Launch
  ([The paid offer and price](paid-offer-and-price.md)).
- GlitchTip receives no customer-linked identifier
  ([Hosted telemetry and data boundary](hosted-telemetry-and-data-boundary.md))
  and documents daily snapshots retained for seven days, separate from its
  ninety-day event retention.

## Decision

### One Backup Window of seven days

The **Backup Window** is the single period within which the service can be
restored and after which a deleted account's content no longer exists in any
Tendnote backup. It is seven days, one named domain constant, and it drives:

- the Neon history window, configured to it on the Launch plan or higher.
  Raising the setting from six hours to seven days is a launch checklist item,
  and monitoring compares the live setting against the constant;
- the ceiling for every other retained surface (below);
- the published recovery sentence and the published deletion tail.

Seven days is Launch's maximum. That is a safeguard for the deletion tail,
because the configuration cannot drift past the published number without a
plan change. It is acceptable for recovery because the recovery promise makes
no per-point guarantee. One day was rejected: a solo operator who notices
corruption after a weekend could not recover, and the two-business-day support
pace makes a weekend-length gap ordinary.

**Published wording**, final copy subject to the Hosted Obligations Register:

- Recovery: "Tendnote can restore the service to a point within the last seven
  days. Recovery is a whole-service operation, not per account, and no
  specific restore point is guaranteed."
- Deletion tail: "Residual copies of deleted content expire from our backups
  within seven days, and a restore never brings deleted accounts back."

### Every surface stays inside the window

- No scheduled snapshots on the production project.
- Manual snapshots only with an explicit expiry inside the Backup Window.
- Each `_old_` restore backup branch is deleted once its restore is verified,
  and never later than one Backup Window after the restore.
- A scripted check, not only a runbook step, lists snapshots and branches and
  flags any that would outlive the window. A surface found older than the
  window is a Suspected Incident under the
  [incident runbook](hosted-runbooks-and-tabletop.md), because the published
  deletion tail has been broken.
- Any new backup surface, such as scheduled `pg_dump` exports, requires this
  decision to be revisited before it is added.

### Deletion closes the account immediately

Deletion follows the Recovery Journal's write-before-delete order: commit an
intent, write the Deletion Record, then delete rows. What the customer
experiences stays immediate:

- When the intent commits, the account closes: every session is revoked and
  admission is denied. This is the moment the customer's screen confirms.
- Live content is removed normally within minutes, once the Deletion Record is
  journaled and the existing disposition runs.
- An intent still incomplete after 24 hours raises an operator alert. During a
  Service-Wide Hold, which suspends deletion, the intent waits and the alert
  starts counting when the hold lifts.

Customer wording: "Your account closes immediately and its content is removed
from the live service within minutes." The disposition-table bullets in the
privacy artifact are unchanged apart from the backup line.

### Every irreversible purge writes a Deletion Record

A restore to a point before any purge would otherwise resurrect what it
removed. Three paths therefore journal before deleting:

- self-service account deletion;
- the Lapsed purge, which is an account deletion and uses the same record;
- the household purge under
  [ADR 0221](../adr/0221-household-erasure-closes-the-recovery-window-it-opens.md),
  which adds a household subject kind.

The Deletion Record stays content-free: subject kind, subject id, and time.
Recovery re-applies each record through that kind's existing purge path,
idempotently.

### Retention values

| Constant | Value | Derivation |
| --- | --- | --- |
| Backup Window | 7 days | Launch maximum; covers a missed weekend plus the support pace |
| Deletion Record Retention | 30 days | Backup Window plus a margin to detect and remove a stray surface |
| Fence retention | 14 days | Backup Window plus a margin; fences are consulted only inside the window |

Each is its own named constant and none reuses the ninety-day Lapsed value. Any
new backup surface requires all three to be recomputed.

### Telemetry backups are disclosed separately

The Privacy Policy gives GlitchTip its own retention row: unlinked error
diagnostics under the provider's ninety-day event policy, plus the provider's
separate seven-day backup snapshots, with no account-specific erasure promise.
The Backup Window covers Tendnote's own stores only. The two seven-day figures
are coincidental and are not one constant.

### The restore drill

The drill proves this design, so it belongs here:

- A passed drill on an isolated copy of production gates launch.
- It reruns after any change to the Deletion Record, admission records, asset
  byte storage, or authentication stores, and at least every six months.
- If a drill is overdue or has failed, the recovery sentence is withdrawn from
  public copy until one passes. The deletion tail stays published because it
  rests on configuration and the Deletion Record, not on the drill.
- The drill covers the verification list in
  [Recovery Journal mechanics](../research/phase-9b-recovery-journal.md): a
  journal write failing mid-deletion and the cron completing it; a restore
  across an account deletion, a Lapsed purge, and a household purge, each
  staying gone; a restore across a completed email send that is not re-sent;
  a drain with a write in flight at cutover; a retention sweep deleting an
  expired Deletion Record; and Blob `list()` read-after-create visibility,
  measured rather than assumed. It also runs the surface check against a
  deliberately planted over-age snapshot.

## Reconciled artifacts

- [Hosted privacy and customer-lifecycle obligations](hosted-privacy-and-customer-lifecycle-obligations.md):
  retention table, deletion promise, and register rows now state the Backup
  Window.
- [Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md):
  the Recovery section points here for the window, the Deletion Record
  Retention value, and the drill cadence.
- [Marketing site and demo experience](marketing-site-and-demo-experience.md):
  the conflict note is settled, and marketing may use the seven-day wording
  above once the register clears it.
- [Hosted telemetry and data boundary](hosted-telemetry-and-data-boundary.md):
  the Tendnote database backup row points here.
- [ADR 0250](../adr/0250-one-backup-window-bounds-recovery-and-the-deletion-tail.md)
  records the decision. `CONTEXT.md` gains **Backup Window** and widens
  **Deletion Record**.

## Not decided here

The Neon plan purchase and the history setting change are execution actions.
Counsel and final policy wording go through the Hosted Obligations Register.
Running the drill is launch evidence.
