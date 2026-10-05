import { describe, expect, it } from "vitest";
import { type BackupSurfaceInventory, backupSurfaceFindings } from "./backup-surfaces";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-10T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY_MS);

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

function inventory(overrides: Partial<BackupSurfaceInventory> = {}): BackupSurfaceInventory {
  return {
    historyRetentionSeconds: SEVEN_DAYS_SECONDS,
    snapshots: [],
    branches: [
      {
        id: "br-production",
        name: "production",
        default: true,
        createdAt: daysAgo(400),
        parentId: null,
        parentTimestamp: null,
        restoredFromSnapshotId: null,
        expiresAt: null,
      },
    ],
    ...overrides,
  };
}

const snapshot = (input: { capturedAt: Date; expiresAt: Date | null; scheduled?: boolean }) => ({
  id: "snap-one",
  name: "before migration",
  scheduled: false,
  ...input,
});

const branch = (input: {
  id?: string;
  name?: string;
  createdAt: Date;
  parentId?: string | null;
  parentTimestamp?: Date | null;
  restoredFromSnapshotId?: string | null;
  expiresAt?: Date | null;
}) => ({
  id: input.id ?? "br-other",
  name: input.name ?? "scratch",
  default: false,
  createdAt: input.createdAt,
  parentId: input.parentId ?? null,
  parentTimestamp: input.parentTimestamp ?? null,
  restoredFromSnapshotId: input.restoredFromSnapshotId ?? null,
  expiresAt: input.expiresAt ?? null,
});

describe("backupSurfaceFindings", () => {
  it("finds nothing when the history setting matches the Backup Window and nothing else is retained", () => {
    expect(backupSurfaceFindings(inventory(), now)).toEqual([]);
  });

  it("flags a history setting above or below the Backup Window", () => {
    for (const configured of [21_600, 30 * 24 * 60 * 60]) {
      expect(
        backupSurfaceFindings(inventory({ historyRetentionSeconds: configured }), now),
      ).toEqual([
        {
          surface: "history_window",
          configuredSeconds: configured,
          expectedSeconds: SEVEN_DAYS_SECONDS,
        },
      ]);
    }
  });

  it("flags a snapshot with no expiry at once, before it is over age", () => {
    expect(
      backupSurfaceFindings(
        inventory({ snapshots: [snapshot({ capturedAt: daysAgo(0), expiresAt: null })] }),
        now,
      ),
    ).toEqual([{ surface: "snapshot", id: "snap-one", name: "before migration" }]);
  });

  it("flags a snapshot whose expiry falls past one window after the point it captured", () => {
    const capturedAt = daysAgo(1);
    const late = new Date(capturedAt.getTime() + 7 * DAY_MS + 1000);
    const inside = new Date(capturedAt.getTime() + 7 * DAY_MS);
    expect(
      backupSurfaceFindings(
        inventory({ snapshots: [snapshot({ capturedAt, expiresAt: late })] }),
        now,
      ),
    ).toHaveLength(1);
    expect(
      backupSurfaceFindings(
        inventory({ snapshots: [snapshot({ capturedAt, expiresAt: inside })] }),
        now,
      ),
    ).toEqual([]);
  });

  it("flags any scheduled snapshot, since the production project must have none", () => {
    expect(
      backupSurfaceFindings(
        inventory({
          snapshots: [
            snapshot({ capturedAt: daysAgo(0), expiresAt: daysAhead(1), scheduled: true }),
          ],
        }),
        now,
      ),
    ).toEqual([{ surface: "snapshot", id: "snap-one", name: "before migration" }]);
  });

  it("flags a snapshot still listed past the window although its expiry was inside it", () => {
    expect(
      backupSurfaceFindings(
        inventory({ snapshots: [snapshot({ capturedAt: daysAgo(8), expiresAt: daysAgo(2) })] }),
        now,
      ),
    ).toHaveLength(1);
  });

  it("flags a branch only once it is older than the window, unless its expiry is already late", () => {
    expect(
      backupSurfaceFindings(inventory({ branches: [branch({ createdAt: daysAgo(6) })] }), now),
    ).toEqual([]);
    expect(
      backupSurfaceFindings(inventory({ branches: [branch({ createdAt: daysAgo(8) })] }), now),
    ).toEqual([{ surface: "branch", id: "br-other", name: "scratch" }]);
    expect(
      backupSurfaceFindings(
        inventory({ branches: [branch({ createdAt: daysAgo(1), expiresAt: daysAhead(30) })] }),
        now,
      ),
    ).toHaveLength(1);
  });

  it("ages a branch from the parent point it copied, not from when it was created", () => {
    expect(
      backupSurfaceFindings(
        inventory({ branches: [branch({ createdAt: daysAgo(1), parentTimestamp: daysAgo(8) })] }),
        now,
      ),
    ).toHaveLength(1);
  });

  it("ages a branch restored from a snapshot from the point the snapshot captured", () => {
    expect(
      backupSurfaceFindings(
        inventory({
          snapshots: [snapshot({ capturedAt: daysAgo(8), expiresAt: daysAgo(1) })],
          branches: [branch({ createdAt: daysAgo(1), restoredFromSnapshotId: "snap-one" })],
        }),
        now,
      ),
    ).toContainEqual({ surface: "branch", id: "br-other", name: "scratch" });
  });

  it("ages a branch of another branch from that branch's own copy point", () => {
    const restoreBackup = branch({
      id: "br-old",
      name: `production_old_${daysAgo(8).toISOString()}`,
      createdAt: daysAgo(400),
    });
    const child = branch({
      id: "br-child",
      name: "drill",
      createdAt: daysAgo(1),
      parentId: "br-old",
      parentTimestamp: daysAgo(1),
    });
    expect(
      backupSurfaceFindings(inventory({ branches: [restoreBackup, child] }), now),
    ).toContainEqual({ surface: "branch", id: "br-child", name: "drill" });
  });

  it("ages a restore backup branch from the restore its name records", () => {
    // Neon keeps the pre-restore branch object, so its created_at is the original branch's.
    const restoreBackup = (name: string) =>
      inventory({ branches: [branch({ name, createdAt: daysAgo(400) })] });

    expect(
      backupSurfaceFindings(restoreBackup(`production_old_${daysAgo(2).toISOString()}`), now),
    ).toEqual([]);
    expect(
      backupSurfaceFindings(restoreBackup(`production_old_${daysAgo(8).toISOString()}`), now),
    ).toHaveLength(1);
    // A name that records no readable time, or a future one, falls back to created_at.
    expect(backupSurfaceFindings(restoreBackup("production_old_pre_bug"), now)).toHaveLength(1);
    expect(
      backupSurfaceFindings(restoreBackup(`production_old_${daysAhead(1).toISOString()}`), now),
    ).toHaveLength(1);
  });

  it("never flags the default branch, whose history the history setting bounds", () => {
    expect(
      backupSurfaceFindings(
        inventory({
          branches: [
            {
              id: "br-production",
              name: "production",
              default: true,
              createdAt: daysAgo(400),
              parentId: null,
              parentTimestamp: daysAgo(400),
              restoredFromSnapshotId: null,
              expiresAt: null,
            },
          ],
        }),
        now,
      ),
    ).toEqual([]);
  });
});
