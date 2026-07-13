import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's convention: the drizzle store
// has no live-DB harness, so we pin the production behaviors the in-memory store
// cannot exercise for it. The review-evidence lifecycle tests
// (review-evidence.test.ts) are the behavioral contract; these keep the drizzle
// implementation from quietly dropping its side of it.
const source = readFileSync(join(import.meta.dirname, "drizzle-evidence-store.ts"), "utf8");
const schemaSource = readFileSync(
  join(import.meta.dirname, "../../schema/app/asset-evidence.ts"),
  "utf8",
);

describe("asset evidence drizzle store guards (#200)", () => {
  it("owner-keys every evidence read/write", () => {
    expect(source).toContain("assetEvidence.ownerUserId, input.ownerUserId");
  });

  it("validates re-anchor patches with the defaults-free schema", () => {
    expect(source).toContain("assetEvidenceUpdateSchema.parse(input.patch)");
    expect(source).not.toContain("assetEvidenceSchema.partial(");
  });

  it("filters visible evidence reads with the shared scope predicate", () => {
    // Per-record filtering through the one shared predicate (ADR 0153), with the
    // asset_evidence record kind and the `ae` alias.
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('recordKind: "asset_evidence"');
    expect(source).toContain('tableAlias: "ae"');
    expect(source).toContain('alias(assetEvidence, "ae")');
  });

  it("gates every visible evidence read on a durable anchor asset", () => {
    // Evidence riding a still-pending review group must never reach a member —
    // the same durable-status rule every scope-visible asset read applies.
    expect(source).toContain("DURABLE_ASSET_STATUSES");
    const guardedReads = source.split("durableAnchorExists()").length - 1;
    expect(guardedReads).toBeGreaterThanOrEqual(3); // definition + both visible reads
  });

  it("writes evidence metadata and bytes in one transaction", () => {
    expect(source).toContain(".transaction(");
    expect(source).toContain("assetEvidenceFiles");
  });

  it("orders evidence oldest-first with an id tiebreak, matching the in-memory store", () => {
    expect(source).toContain("asc(assetEvidence.createdAt), asc(assetEvidence.id)");
  });

  it("cascades stored bytes with their evidence row at the schema level", () => {
    // asset_evidence_files.evidence_id → asset_evidence.id, on delete cascade:
    // deleting evidence (or its asset, or its owner) deletes the bytes, so no
    // orphaned file bucket can form.
    expect(schemaSource).toMatch(
      /evidenceId[\s\S]*?references\(\(\) => assetEvidence\.id, \{ onDelete: "cascade" \}\)/,
    );
  });

  it("never selects bytes on a metadata read", () => {
    // Lists and gets stay light: the only byte read is the dedicated
    // getAssetEvidenceFileBytes select.
    const byteSelects = source.split("assetEvidenceFiles.bytes").length - 1;
    expect(byteSelects).toBe(1);
  });
});
