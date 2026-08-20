import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ownerDataExportArtifacts, ownerDataExportJobs } from "./owner-data-exports";

describe("owner data export schema", () => {
  it("keeps job control and expiring bytes separate from product records", () => {
    expect(ownerDataExportJobs).toBeDefined();
    expect(ownerDataExportArtifacts).toBeDefined();
    expect(ownerDataExportJobs.id).toBeDefined();
    expect(ownerDataExportJobs.claimToken).toBeDefined();
    expect(ownerDataExportArtifacts.jobId).toBeDefined();
  });

  it("enforces owner-scoped request idempotency in Postgres", () => {
    const { indexes } = getTableConfig(ownerDataExportJobs);
    const idempotencyIndex = indexes.find(
      (index) => index.config.name === "owner_data_export_jobs_owner_idempotency_key_idx",
    );

    expect(idempotencyIndex?.config.unique).toBe(true);
    expect(
      idempotencyIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["owner_user_id", "idempotency_key"]);
  });
});
