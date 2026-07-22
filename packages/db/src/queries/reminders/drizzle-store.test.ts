import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Reminder Drizzle store contract", () => {
  it("owner-scopes schedule, installation, job, and minimized audit persistence", () => {
    const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");
    const migration = readFileSync(
      join(import.meta.dirname, "../../../migrations/0047_reminder_push.sql"),
      "utf8",
    );

    expect(source).toContain("eq(reminderSchedules.ownerUserId, input.ownerUserId)");
    expect(source).toContain("eq(reminderInstallations.ownerUserId, input.ownerUserId)");
    expect(source).toContain("eq(reminderDeliveryJobs.ownerUserId, input.ownerUserId)");
    expect(source).toContain("tx.insert(auditLog)");
    expect(source).not.toContain("metadataJson: { endpoint");
    expect(migration).toContain('CREATE TABLE "reminder_schedules"');
    expect(migration).toContain('CREATE TABLE "reminder_installations"');
    expect(migration).toContain('CREATE TABLE "reminder_delivery_jobs"');
    expect(migration).toContain("ADD VALUE 'reminder_push'");
    expect(migration).toContain("reminder_schedules_owner_action_idx");
    expect(migration).toContain("reminder_delivery_jobs_occurrence_installation_idx");
  });
});
