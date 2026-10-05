# ADR 0259: The backup-surface check reads Neon from the recovery cron

Status: Accepted in the October 4, 2026 implementation of issue #622.

## Context

[ADR 0250](0250-one-backup-window-bounds-recovery-and-the-deletion-tail.md)
requires a scripted check that compares the live Neon history setting with the
Backup Window and flags any snapshot or branch that would outlive it. A finding
is a Suspected Incident and must reach the operator alert channel
([ADR 0258](0258-operator-alerts-are-condition-episodes-sent-by-email-and-ntfy.md)),
whose conditions are states read on each recovery cron pass. Neon exposes the
three facts through its API: `history_retention_seconds` on the project, and
the snapshot and branch lists. Reading them needs a Neon API key.

## Decision

**The check runs inside the recovery cron, with a project-scoped key.** With
`NEON_API_KEY` and `NEON_PROJECT_ID` set, each alert pass reads the project,
its snapshots, and its branches, and feeds the `backup_surface` condition. A
read that fails gives no reading, so an open alert holds. The same function
runs on demand as `pnpm --filter @tendnote/web backup-surfaces`, which exits 1
on any finding. The key must be a project-scoped organization key: Neon offers
no read-only key, and a project-scoped one cannot delete the project, though it
can change or delete anything inside it.

**What counts as outliving the window.** Every surface is aged from the point
its copy of production dates from, because data deleted just after that point
lives on in it for as long as it exists:

- The history setting must equal the Backup Window exactly. Shorter breaks the
  recovery promise; longer breaks the deletion tail.
- A scheduled snapshot is flagged at once, since the production project must
  have none.
- A manual snapshot is aged from the point it captured. One with no expiry is
  flagged at once, since manual snapshots must always carry one; one whose
  expiry falls past a window after that point is flagged at once too.
- A branch other than the default is aged from the parent point it copied, and
  flagged once older than a window, or at once if its expiry is already late.
  A branch restored from a snapshot is aged from what that snapshot captured,
  and a branch of another non-default branch from that branch's copy point.
- A restore backup branch is the pre-restore branch object, so its creation
  time is the original branch's. It is aged from the restore time in Neon's
  `{branch_name}_old_{head_timestamp}` name. Restore tooling that names the
  preserved branch itself must keep that form; a name without a readable time
  is aged from creation, which alerts early rather than late.

## Consequences

- The web runtime holds a credential that can delete branches and snapshots or
  change the history setting. That is less than the database URL it already
  holds can destroy, but it reaches recovery itself. The key lives in the
  private operations sheet and rotates with Neon in the credential-rotation
  order.
- The check runs every ten minutes, three Neon API requests a pass, and only
  while the alert channel is on.
- A finding alerts once per episode and is logged as `backup_surface.finding`
  on every pass it holds, naming the surface by its Neon id and name.
- Neon's preview branch recovery keeps deleted branches restorable for a while.
  The check does not list them; if that feature is enabled on the production
  project, it reopens ADR 0250.

## Alternatives considered

**A scheduled GitHub Actions workflow holding the key.** Rejected because the
finding would have to cross back into the alert channel through a new endpoint
and a stored reading, which is more surface than the key it keeps out of the
runtime.

**A runbook step instead of a check.** Rejected by ADR 0250: the deletion tail
must not depend on the operator remembering.
