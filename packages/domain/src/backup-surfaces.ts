import { RETENTION } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_WINDOW_MS = RETENTION.backupWindow.days * DAY_MS;
const BACKUP_WINDOW_SECONDS = BACKUP_WINDOW_MS / 1000;

/** Neon's name for the branch an instant restore preserves: `{branch_name}_old_{head_timestamp}`. */
const RESTORE_BACKUP_MARKER = "_old_";

type Snapshot = {
  id: string;
  name: string;
  /** Taken by a backup schedule rather than by hand. */
  scheduled: boolean;
  capturedAt: Date;
  expiresAt: Date | null;
};

type Branch = {
  id: string;
  name: string;
  default: boolean;
  createdAt: Date;
  /** `null` for a root branch. */
  parentId: string | null;
  /** The point on the parent the branch copied; `null` for a root branch. */
  parentTimestamp: Date | null;
  /** The snapshot the branch was restored from, if any. */
  restoredFromSnapshotId: string | null;
  expiresAt: Date | null;
};

/** Everything in the production Neon project that can hold a copy of deleted data. */
export type BackupSurfaceInventory = {
  historyRetentionSeconds: number;
  snapshots: Snapshot[];
  branches: Branch[];
};

/** Content-free: provider ids and the names the operator gave them. */
export type BackupSurfaceFinding =
  | { surface: "history_window"; configuredSeconds: number; expectedSeconds: number }
  | { surface: "snapshot" | "branch"; id: string; name: string };

/**
 * When a restore backup branch stopped being production. Neon keeps the
 * pre-restore branch object, so its `created_at` is the original branch's and
 * only its name records the restore. A name with no readable past time falls
 * back to `created_at`, which ages it early rather than late.
 */
function restoreTime(branch: Branch, now: Date): Date | null {
  const marker = branch.name.lastIndexOf(RESTORE_BACKUP_MARKER);
  if (marker < 0) return null;
  const time = new Date(branch.name.slice(marker + RESTORE_BACKUP_MARKER.length));
  return Number.isNaN(time.getTime()) || time > now ? null : time;
}

const earliest = (times: Date[]) => new Date(Math.min(...times.map((time) => time.getTime())));

/**
 * The point a branch's copy of production dates from: deletions after it live
 * on in the branch. A branch restored from a snapshot dates from what the
 * snapshot captured, and a branch of another non-default branch from that
 * branch's own copy point.
 */
function branchCopiedAt(
  branch: Branch,
  inventory: BackupSurfaceInventory,
  now: Date,
  visited: ReadonlySet<string> = new Set(),
): Date {
  const times = [
    restoreTime(branch, now) ?? earliest([branch.createdAt, branch.parentTimestamp ?? now]),
  ];
  const snapshot = inventory.snapshots.find(({ id }) => id === branch.restoredFromSnapshotId);
  if (snapshot) times.push(snapshot.capturedAt);
  const parent = inventory.branches.find(({ id }) => id === branch.parentId);
  if (parent && !parent.default && !visited.has(parent.id)) {
    times.push(branchCopiedAt(parent, inventory, now, new Set(visited).add(branch.id)));
  }
  return earliest(times);
}

/**
 * Whether a copy taken at `copiedAt` would outlive the Backup Window: data
 * deleted just after it must be gone one window later (ADR 0250). A copy with
 * an expiry is judged by that expiry at once; one without is judged by its age,
 * unless it must carry an expiry, in which case it fails at once.
 */
function outlivesWindow(input: {
  copiedAt: Date;
  expiresAt: Date | null;
  expiryRequired: boolean;
  now: Date;
}): boolean {
  const deadline = input.copiedAt.getTime() + BACKUP_WINDOW_MS;
  if (input.now.getTime() > deadline) return true;
  if (input.expiresAt) return input.expiresAt.getTime() > deadline;
  return input.expiryRequired;
}

/**
 * The backup-surface check (#622, ADR 0250): the live history setting must
 * equal the Backup Window, there must be no scheduled snapshots, every manual
 * snapshot must expire within one window of the point it captured, and every branch other than production must be gone
 * within one window of the point it copied. Each finding breaks the published
 * deletion tail, so any finding is a Suspected Incident.
 */
export function backupSurfaceFindings(
  inventory: BackupSurfaceInventory,
  now: Date,
): BackupSurfaceFinding[] {
  const findings: BackupSurfaceFinding[] = [];
  if (inventory.historyRetentionSeconds !== BACKUP_WINDOW_SECONDS) {
    findings.push({
      surface: "history_window",
      configuredSeconds: inventory.historyRetentionSeconds,
      expectedSeconds: BACKUP_WINDOW_SECONDS,
    });
  }
  for (const snapshot of inventory.snapshots) {
    const copy = { copiedAt: snapshot.capturedAt, expiresAt: snapshot.expiresAt };
    if (snapshot.scheduled || outlivesWindow({ ...copy, expiryRequired: true, now })) {
      findings.push({ surface: "snapshot", id: snapshot.id, name: snapshot.name });
    }
  }
  for (const branch of inventory.branches) {
    if (branch.default) continue;
    const copy = {
      copiedAt: branchCopiedAt(branch, inventory, now),
      expiresAt: branch.expiresAt,
    };
    if (outlivesWindow({ ...copy, expiryRequired: false, now })) {
      findings.push({ surface: "branch", id: branch.id, name: branch.name });
    }
  }
  return findings;
}
