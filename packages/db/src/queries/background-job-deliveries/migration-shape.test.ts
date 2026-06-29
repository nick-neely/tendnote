import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(__dirname, "../../../migrations/0012_background_job_deliveries.sql"),
  "utf8",
);

describe("background job delivery migration", () => {
  it("adds enum-backed delivery state and recovery indexes", () => {
    expect(migration).toContain('CREATE TYPE "public"."background_job_kind"');
    expect(migration).toContain("'extraction'");
    expect(migration).toContain("'embedding'");
    expect(migration).toContain('CREATE TYPE "public"."background_job_delivery_status"');
    expect(migration).toContain("'pending'");
    expect(migration).toContain("'published'");
    expect(migration).toContain("'publish_failed'");
    expect(migration).toContain("'abandoned'");
    expect(migration).toContain('CREATE TABLE "background_job_deliveries"');
    expect(migration).toContain('"owner_user_id" text NOT NULL');
    expect(migration).toContain('"job_kind" "background_job_kind" NOT NULL');
    expect(migration).toContain('"status" "background_job_delivery_status" DEFAULT \'pending\'');
    expect(migration).toContain('CREATE UNIQUE INDEX "background_job_deliveries_job_topic_idx"');
    expect(migration).toContain('CREATE INDEX "background_job_deliveries_status_next_attempt_idx"');
    expect(migration).toContain('CREATE INDEX "background_job_deliveries_owner_status_idx"');
    expect(migration).toContain('CREATE INDEX "background_job_deliveries_job_idx"');
  });
});
