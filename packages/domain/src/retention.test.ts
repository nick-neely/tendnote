import { describe, expect, it } from "vitest";
import { AUDIT_LOG_DEFAULT_RETENTION_YEARS } from "./audit-retention";
import { householdPurgeCutoff, householdRecoveryDeadline } from "./household-governance";
import { publishedRetentionKeys, RETENTION, renderRetentionTable } from "./retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retention constants", () => {
  it("holds every published retention value once", () => {
    expect(RETENTION).toEqual({
      lapsedAccount: { days: 90 },
      backupWindow: { days: 7 },
      deletionRecord: { days: 30 },
      deletionFence: { days: 14 },
      accountLinkedFunnelEvents: { days: 90 },
      anonymousDailyTotals: { months: 13 },
      usageLedger: { months: 13 },
      supportEmail: { years: 2 },
      incidentRecord: { years: 3 },
      householdRecoveryWindow: { days: 30 },
      auditLog: { years: 2 },
    });
  });

  it("drives the household purge sweep", () => {
    const dissolvedAt = new Date("2026-01-01T00:00:00.000Z");
    const windowMs = RETENTION.householdRecoveryWindow.days * DAY_MS;

    expect(householdRecoveryDeadline(dissolvedAt).getTime() - dissolvedAt.getTime()).toBe(windowMs);
    expect(dissolvedAt.getTime() - householdPurgeCutoff(dissolvedAt).getTime()).toBe(windowMs);
  });

  it("drives the audit retention sweep", () => {
    expect(AUDIT_LOG_DEFAULT_RETENTION_YEARS).toBe(RETENTION.auditLog.years);
  });
});

describe("published retention table", () => {
  it("publishes every constant", () => {
    expect(publishedRetentionKeys().sort()).toEqual(Object.keys(RETENTION).sort());
  });

  it("states each period in words the reader can check against the constant", () => {
    const table = renderRetentionTable();

    expect(table).toContain(
      "| Lapsed account content | 90 days from entering Lapsed, then deleted |",
    );
    expect(table).toContain("13 months");
    expect(table).toContain("3 years from closure");
  });

  it("matches the committed table, so the policy cannot drift from the sweeps", async () => {
    // Regenerate after changing a constant with:
    //   pnpm --filter @tendnote/domain exec vitest run src/retention.test.ts -u
    await expect(renderRetentionTable()).toMatchFileSnapshot(
      "../../../docs/legal/privacy-retention-table.md",
    );
  });
});
