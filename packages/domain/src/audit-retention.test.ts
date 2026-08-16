import { describe, expect, it } from "vitest";
import {
  auditLogRetentionDeadline,
  getAuditLogRetentionCutoffs,
  getAuditLogRetentionPolicy,
  isAuditLogEntryExpired,
} from "./audit-retention";

describe("audit log retention policy", () => {
  it("keeps the household purge tombstone for two calendar years", () => {
    const createdAt = new Date("2024-06-15T12:34:56.000Z");

    expect(
      getAuditLogRetentionPolicy({ action: "household.purge", entityType: "household" }),
    ).toEqual({
      retentionYears: 2,
      readAccess: "internal",
      disposal: "hard_delete",
    });
    expect(
      auditLogRetentionDeadline({
        action: "household.purge",
        entityType: "household",
        createdAt,
      }),
    ).toEqual(new Date("2026-06-15T12:34:56.000Z"));
  });

  it("uses the documented two-year internal policy for future entries by default", () => {
    expect(
      getAuditLogRetentionPolicy({ action: "future.action", entityType: "future_entity" }),
    ).toEqual({
      retentionYears: 2,
      readAccess: "internal",
      disposal: "hard_delete",
    });
  });

  it("expires exactly at the deadline and not before it", () => {
    const createdAt = new Date("2024-06-15T12:34:56.000Z");
    const before = new Date("2026-06-15T12:34:55.999Z");
    const at = new Date("2026-06-15T12:34:56.000Z");

    expect(
      isAuditLogEntryExpired({
        action: "household.purge",
        entityType: "household",
        createdAt,
        now: before,
      }),
    ).toBe(false);
    expect(
      isAuditLogEntryExpired({
        action: "household.purge",
        entityType: "household",
        createdAt,
        now: at,
      }),
    ).toBe(true);
  });

  it("builds separate ranges for a leap-day source boundary", () => {
    const now = new Date("2026-02-28T12:34:56.000Z");
    const [regularPartition, leapDayPartition] = getAuditLogRetentionCutoffs({
      now,
      policies: [],
      defaultRetentionYears: 2,
    });

    expect(leapDayPartition).toEqual(
      expect.objectContaining({
        createdAtAfter: new Date("2024-02-29T00:00:00.000Z"),
        createdAtBefore: new Date("2024-02-29T12:34:56.000Z"),
      }),
    );
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-02-28T12:34:56.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-02-28T12:34:56.001Z"),
        now,
      }),
    ).toBe(false);
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-02-29T12:34:55.999Z"),
        now,
      }),
    ).toBe(true);
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-02-29T12:34:56.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-02-29T12:34:56.001Z"),
        now,
      }),
    ).toBe(false);
    expect(
      isAuditLogEntryExpired({
        action: "future.action",
        entityType: "future_entity",
        createdAt: new Date("2024-03-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);

    expect(regularPartition).toEqual(
      expect.objectContaining({
        createdAtBefore: new Date("2024-02-28T12:34:56.000Z"),
      }),
    );
  });

  it("selects every non-leap February 28 timestamp when now is February 29", () => {
    const now = new Date("2028-02-29T12:34:56.000Z");

    const cases = [
      ["same clock", "2026-02-28T12:34:56.000Z", true],
      ["subsecond after same clock", "2026-02-28T12:34:56.001Z", true],
      ["before end-of-day boundary", "2026-02-28T23:59:59.998Z", true],
      ["at end-of-day boundary", "2026-02-28T23:59:59.999Z", true],
      ["after source-day boundary", "2026-03-01T00:00:00.000Z", false],
    ] as const;

    for (const [, createdAt, expected] of cases) {
      expect(
        isAuditLogEntryExpired({
          action: "future.action",
          entityType: "future_entity",
          createdAt: new Date(createdAt),
          now,
        }),
      ).toBe(expected);
    }

    const [partition] = getAuditLogRetentionCutoffs({
      now,
      policies: [],
      defaultRetentionYears: 2,
    });
    expect(partition).toEqual(
      expect.objectContaining({
        createdAtBefore: new Date("2026-02-28T23:59:59.999Z"),
      }),
    );
  });

  it("builds explicit and unknown/default cutoffs from one policy definition", () => {
    const cutoffs = getAuditLogRetentionCutoffs({
      now: new Date("2026-06-15T12:34:56.000Z"),
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
    });

    expect(cutoffs).toEqual([
      expect.objectContaining({
        action: "long.retention",
        entityType: "long_record",
        retentionYears: 10,
        createdAtBefore: new Date("2016-06-15T12:34:56.000Z"),
        excludedKeys: [],
      }),
      expect.objectContaining({
        action: "short.retention",
        entityType: "short_record",
        retentionYears: 1,
        createdAtBefore: new Date("2025-06-15T12:34:56.000Z"),
        excludedKeys: [],
      }),
      expect.objectContaining({
        action: null,
        entityType: null,
        retentionYears: 2,
        createdAtBefore: new Date("2024-06-15T12:34:56.000Z"),
        excludedKeys: [
          { action: "long.retention", entityType: "long_record" },
          { action: "short.retention", entityType: "short_record" },
        ],
      }),
    ]);
  });
});
