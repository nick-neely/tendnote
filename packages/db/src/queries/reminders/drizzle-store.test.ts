import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../../client", () => ({ getDb }));

const { createDrizzleReminderStore } = await import("./drizzle-store");

describe("Reminder Drizzle store contract", () => {
  it("owner-scopes schedule, installation, job, and minimized audit persistence", () => {
    const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
    const migration = readFileSync(
      join(import.meta.dirname, "../../../migrations/0047_reminder_push.sql"),
      "utf8",
    );
    const crossDomainMigration = readFileSync(
      join(import.meta.dirname, "../../../migrations/0048_cross_domain_reminders.sql"),
      "utf8",
    );

    expect(source).toContain("eq(reminderSchedules.ownerUserId, input.ownerUserId)");
    expect(source).toContain("eq(reminderInstallations.ownerUserId, input.ownerUserId)");
    expect(source).toContain("eq(reminderDeliveryJobs.ownerUserId, input.ownerUserId)");
    expect(source).toContain("eq(reminderSchedules.recordKind, input.recordKind)");
    expect(source).toContain("eq(reminderSchedules.recordId, input.recordId)");
    expect(source).toContain("tx.insert(auditLog)");
    expect(source).not.toContain("metadataJson: { endpoint");
    expect(migration).toContain('CREATE TABLE "reminder_schedules"');
    expect(migration).toContain('CREATE TABLE "reminder_installations"');
    expect(migration).toContain('CREATE TABLE "reminder_delivery_jobs"');
    expect(migration).toContain("ADD VALUE 'reminder_push'");
    expect(migration).toContain("reminder_schedules_owner_action_idx");
    expect(migration).toContain("reminder_delivery_jobs_occurrence_installation_idx");
    expect(crossDomainMigration).toContain(
      "ENUM('general_action', 'follow_up', 'routine', 'saved_item')",
    );
    expect(crossDomainMigration).toContain(
      'UPDATE "reminder_schedules" SET "record_id" = "general_action_id"',
    );
    expect(crossDomainMigration).toContain("reminder_schedules_owner_record_idx");
  });
});

describe("Reminder Drizzle executable parity", () => {
  it("upserts a cross-domain schedule through the replacement conflict path", async () => {
    const row = {
      id: "schedule-1",
      ownerUserId: "owner-1",
      recordKind: "saved_item" as const,
      recordId: "22222222-2222-4222-8222-222222222222",
      generalActionId: null,
      kind: "relative" as const,
      localTime: null,
      leadMinutes: 60,
      timeZone: "America/Chicago",
      occurrenceKey: "2026-08-14T16:00:00.000Z",
      intendedAt: new Date("2026-08-14T15:00:00.000Z"),
      createdAt: new Date("2026-07-21T15:00:00.000Z"),
      updatedAt: new Date("2026-07-21T15:00:00.000Z"),
    };
    const returning = vi.fn().mockResolvedValue([row]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    getDb.mockReturnValue({ insert: vi.fn(() => ({ values })) });

    await expect(
      createDrizzleReminderStore().upsertSchedule({
        ownerUserId: row.ownerUserId,
        recordKind: row.recordKind,
        recordId: row.recordId,
        choice: { kind: "relative", leadMinutes: 60 },
        timeZone: row.timeZone,
        occurrenceKey: row.occurrenceKey,
        intendedAt: row.intendedAt,
        now: row.updatedAt,
      }),
    ).resolves.toEqual(row);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        recordKind: "saved_item",
        recordId: row.recordId,
        generalActionId: null,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ leadMinutes: 60, occurrenceKey: row.occurrenceKey }),
      }),
    );
  });

  it("executes lifecycle suppression as a superseding Drizzle update", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    getDb.mockReturnValue({ update: vi.fn(() => ({ set })) });
    const now = new Date("2026-07-21T15:00:00.000Z");

    await createDrizzleReminderStore().supersedeOccurrenceIntents({
      ownerUserId: "owner-1",
      recordKind: "routine",
      recordId: "22222222-2222-4222-8222-222222222222",
      now,
    });

    expect(set).toHaveBeenCalledWith({ status: "superseded", updatedAt: now });
    expect(where).toHaveBeenCalledOnce();
  });
});
