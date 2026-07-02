import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(__dirname, "../../../migrations/0020_pale_whizzer.sql"),
  "utf8",
);

describe("scheduled workflow delivery migration", () => {
  it("adds per-workflow Discord settings and a recoverable attempt ledger", () => {
    expect(migration).toContain('CREATE TYPE "public"."phase3_scheduled_workflow"');
    expect(migration).toContain("'morning_agenda'");
    expect(migration).toContain("'post_meeting_aftercare'");
    expect(migration).toContain("'weekly_relationship_review'");
    expect(migration).toContain("'birthday_gift_planning'");
    expect(migration).toContain('CREATE TYPE "public"."proactive_delivery_channel"');
    expect(migration).toContain("'discord'");
    expect(migration).toContain('CREATE TYPE "public"."proactive_delivery_status"');
    expect(migration).toContain("'sent'");
    expect(migration).toContain("'skipped'");
    expect(migration).toContain("'failed'");
    expect(migration).toContain('CREATE TABLE "scheduled_workflow_delivery_settings"');
    expect(migration).toContain('CREATE TABLE "scheduled_workflow_delivery_attempts"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "scheduled_workflow_delivery_settings_owner_workflow_channel_idx"',
    );
    expect(migration).toContain('CREATE INDEX "scheduled_workflow_delivery_attempts_artifact_idx"');
    expect(migration).toContain('CREATE INDEX "scheduled_workflow_delivery_attempts_status_idx"');
  });
});
