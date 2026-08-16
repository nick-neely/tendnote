import { getAuditLogRetentionCutoffs } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditLogRetentionStore } from "./in-memory-store";
import { runAuditLogRetentionSweep } from "./sweep";

const NOW = new Date("2026-06-15T12:34:56.000Z");

function entry(id: string, createdAt: string) {
  return {
    id,
    action: "household.purge",
    entityType: "household",
    createdAt: new Date(createdAt),
  } as const;
}

describe("audit log retention sweep", () => {
  it("deletes due entries at the exact policy boundary and is safe to repeat", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      entry("expired", "2024-06-15T12:34:56.000Z"),
      entry("new", "2024-06-15T12:34:56.001Z"),
    ]);

    await expect(runAuditLogRetentionSweep({ limit: 10, now: NOW, store })).resolves.toEqual({
      scanned: 1,
      deleted: 1,
      skipped: 0,
      failed: 0,
    });
    expect(store.entries().map((item) => item.id)).toEqual(["new"]);

    await expect(runAuditLogRetentionSweep({ limit: 10, now: NOW, store })).resolves.toEqual({
      scanned: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("bounds work and isolates one row's deletion failure", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      entry("first", "2024-01-01T00:00:00.000Z"),
      entry("second", "2024-02-01T00:00:00.000Z"),
      entry("third", "2024-03-01T00:00:00.000Z"),
    ]);
    store.failOn.add("second");
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(runAuditLogRetentionSweep({ limit: 2, now: NOW, store, logger })).resolves.toEqual(
      { scanned: 2, deleted: 1, skipped: 0, failed: 1 },
    );
    expect(store.entries().map((item) => item.id)).toEqual(["second", "third"]);
    expect(logger.info).toHaveBeenCalledWith(
      "audit_log_retention.deleted",
      expect.objectContaining({ auditLogId: "first" }),
    );
    expect(logger.error).toHaveBeenCalledWith("audit_log_retention.failed", {
      auditLogId: "second",
      action: "household.purge",
      entityType: "household",
    });
  });

  it("does not expose raw database error details in retention logs", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      entry("secret", "2024-01-01T00:00:00.000Z"),
    ]);
    vi.spyOn(store, "deleteAuditLogEntry").mockRejectedValue(
      new Error("postgres detail: private connection string"),
    );
    const logger = { error: vi.fn() };

    await expect(runAuditLogRetentionSweep({ limit: 1, now: NOW, store, logger })).resolves.toEqual(
      {
        scanned: 1,
        deleted: 0,
        skipped: 0,
        failed: 1,
      },
    );

    expect(logger.error).toHaveBeenCalledWith("audit_log_retention.failed", {
      auditLogId: "secret",
      action: "household.purge",
      entityType: "household",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private connection string");
  });

  it("does not let an old, long-retention row starve a newer expired class", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      {
        id: "long-retention",
        action: "long.retention",
        entityType: "long_record",
        createdAt: new Date("2019-01-01T00:00:00.000Z"),
      },
      {
        id: "short-retention",
        action: "short.retention",
        entityType: "short_record",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);

    const candidates = await store.listAuditLogRetentionCandidates({
      limit: 1,
      cutoffs: getAuditLogRetentionCutoffs({
        now: NOW,
        policies: [
          {
            action: "long.retention",
            entityType: "long_record",
            retentionYears: 10,
            readAccess: "internal",
            disposal: "hard_delete",
          },
          {
            action: "short.retention",
            entityType: "short_record",
            retentionYears: 1,
            readAccess: "internal",
            disposal: "hard_delete",
          },
        ],
        defaultRetentionYears: 2,
      }),
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["short-retention"]);
  });

  it("does not let a leap-day boundary row starve an exact due row", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      {
        id: "boundary-not-due",
        action: "household.purge",
        entityType: "household",
        createdAt: new Date("2024-02-28T12:34:56.001Z"),
      },
      {
        id: "leap-day-due",
        action: "household.purge",
        entityType: "household",
        createdAt: new Date("2024-02-29T12:34:56.000Z"),
      },
    ]);

    await expect(
      runAuditLogRetentionSweep({ limit: 1, now: new Date("2026-02-28T12:34:56.000Z"), store }),
    ).resolves.toEqual({
      scanned: 1,
      deleted: 1,
      skipped: 0,
      failed: 0,
    });
    expect(store.entries().map((item) => item.id)).toEqual(["boundary-not-due"]);
  });

  it("selects late non-leap February 28 rows at a leap-year limit", async () => {
    const now = new Date("2028-02-29T12:34:56.000Z");
    const store = createInMemoryAuditLogRetentionStore([
      {
        id: "late-february-28",
        action: "household.purge",
        entityType: "household",
        createdAt: new Date("2026-02-28T23:59:59.999Z"),
      },
      {
        id: "march-1-not-due",
        action: "household.purge",
        entityType: "household",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);

    await expect(
      store.listAuditLogRetentionCandidates({
        limit: 1,
        cutoffs: getAuditLogRetentionCutoffs({ now }),
      }),
    ).resolves.toMatchObject([{ id: "late-february-28" }]);

    await expect(runAuditLogRetentionSweep({ limit: 1, now, store })).resolves.toEqual({
      scanned: 1,
      deleted: 1,
      skipped: 0,
      failed: 0,
    });
    expect(store.entries().map((item) => item.id)).toEqual(["march-1-not-due"]);
  });

  it("keeps unknown entries in the default partition without duplicating policy rows", async () => {
    const store = createInMemoryAuditLogRetentionStore([
      {
        id: "short-retention",
        action: "short.retention",
        entityType: "short_record",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        id: "unknown-default",
        action: "future.action",
        entityType: "future_record",
        createdAt: new Date("2023-01-01T00:00:00.000Z"),
      },
    ]);
    const cutoffs = getAuditLogRetentionCutoffs({
      now: NOW,
      policies: [
        {
          action: "short.retention",
          entityType: "short_record",
          retentionYears: 1,
          readAccess: "internal",
          disposal: "hard_delete",
        },
      ],
      defaultRetentionYears: 2,
    });

    const candidates = await store.listAuditLogRetentionCandidates({ limit: 10, cutoffs });

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "unknown-default",
      "short-retention",
    ]);
  });

  it("does no work when the pass has no budget", async () => {
    const store = createInMemoryAuditLogRetentionStore([entry("old", "2024-01-01T00:00:00.000Z")]);

    await expect(runAuditLogRetentionSweep({ limit: 0, now: NOW, store })).resolves.toEqual({
      scanned: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    });
    expect(store.entries()).toHaveLength(1);
  });
});
