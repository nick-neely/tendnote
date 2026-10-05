import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const enumMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0074_self_hosted_admission_access_sources.sql"),
  "utf8",
);
const bootstrapIndexMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0076_self_hosted_admission_bootstrap_index.sql"),
  "utf8",
);
const betaSunsetMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0105_beta_sunset.sql"),
  "utf8",
);
const journal = readFileSync(
  join(import.meta.dirname, "../../../migrations/meta/_journal.json"),
  "utf8",
);

describe("self-hosted admission migration contract", () => {
  it("commits access_source enum values before using them in the singleton index", () => {
    expect(enumMigration).toContain("ADD VALUE 'self_hosted_bootstrap'");
    expect(enumMigration).toContain("ADD VALUE 'household_invitation'");
    expect(enumMigration).not.toContain("CREATE UNIQUE INDEX");
    expect(bootstrapIndexMigration).toContain(
      'CREATE UNIQUE INDEX "access_profiles_single_self_hosted_bootstrap_idx"',
    );
    expect(bootstrapIndexMigration).toContain(
      'CREATE FUNCTION "public"."is_self_hosted_bootstrap_access_source"',
    );
    expect(bootstrapIndexMigration).toContain(
      'WHERE "public"."is_self_hosted_bootstrap_access_source"("access_profiles"."source")',
    );
  });

  it("records the isolated repair as the descriptive next Drizzle migration", () => {
    expect(journal).toContain('"idx": 76');
    expect(journal).toContain('"tag": "0076_self_hosted_admission_bootstrap_index"');
  });
});

describe("Beta Sunset migration contract (#612)", () => {
  const sunset = betaSunsetMigration.split("--> statement-breakpoint").at(-1) ?? "";

  it("moves only beta grants to pending, Unpaid, with the beta-ended reason", () => {
    expect(sunset).toContain('UPDATE "access_profiles"');
    expect(sunset).toContain(`"status" = 'pending'`);
    expect(sunset).toContain(`"source" = NULL`);
    expect(sunset).toContain(`"retention_deadline" = NULL`);
    expect(sunset).toContain(`"pending_reason" = 'beta_ended'`);
    expect(sunset).toMatch(/WHERE "source" = 'beta_flag';\s*$/);
  });

  it("leaves the operator's manual grant and every other source alone", () => {
    // One filter, on beta_flag alone, so no other source can match.
    expect(sunset.match(/WHERE/g)).toHaveLength(1);
  });

  it("is the descriptive next Drizzle migration", () => {
    expect(journal).toContain('"tag": "0105_beta_sunset"');
  });
});
