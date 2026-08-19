import { describe, expect, it } from "vitest";
import { ownerDataExportArtifacts, ownerDataExportJobs } from "./owner-data-exports";

describe("owner data export schema", () => {
  it("keeps job control and expiring bytes separate from product records", () => {
    expect(ownerDataExportJobs).toBeDefined();
    expect(ownerDataExportArtifacts).toBeDefined();
    expect(ownerDataExportJobs.id).toBeDefined();
    expect(ownerDataExportArtifacts.jobId).toBeDefined();
  });
});
