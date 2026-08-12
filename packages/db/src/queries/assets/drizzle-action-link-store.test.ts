import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-assertion guard, matching this package's convention: the drizzle store
// has no live-DB harness, so we pin the production behaviors the in-memory store
// cannot exercise for it. The bridge tests (action-links.test.ts) are the
// behavioral contract; these keep the drizzle implementation from quietly
// dropping its side of it.
const source = readFileSync(join(import.meta.dirname, "drizzle-action-link-store.ts"), "utf8");
const actionLinksSource = readFileSync(join(import.meta.dirname, "action-links.ts"), "utf8");
const actionProposalsSource = readFileSync(
  join(import.meta.dirname, "action-proposals.ts"),
  "utf8",
);
const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0072_record_asset_link_creator_provenance.sql"),
  "utf8",
);

describe("general action asset link drizzle store guards (#199)", () => {
  it("creates links idempotently against the unique (action, asset) pair", () => {
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("generalActionAssets.generalActionId, generalActionAssets.assetId");
  });

  it("does not treat creator provenance as authority", () => {
    expect(source).not.toContain("generalActionAssets.createdByUserId, input.ownerUserId");
    expect(actionLinksSource).not.toContain("link.createdByUserId !== input.ownerUserId");
    expect(actionProposalsSource).not.toContain("link.createdByUserId !== ownerUserId");
  });

  it("does not assert unreliable legacy owner keys as creator provenance", () => {
    expect(migration).toContain('UPDATE "general_action_assets" SET "created_by_user_id" = NULL');
  });

  it("scopes destructive mutations to the independently authorized parents", () => {
    expect(source).toContain("lockAndAuthorizeLinkParents");
    expect(source).toContain("getDb().transaction");
    expect(source).toContain('.for("update")');
    expect(source).toContain('eq(householdMemberships.status, "active")');
    expect(source).toContain("statuses.get(input.fromAssetId) !== input.fromAssetStatus");
    expect(source).toContain("statuses.get(input.toAssetId) !== input.toAssetStatus");
    expect(source).toContain(
      "inArray(generalActionAssets.generalActionId, [...authorized.actionIds])",
    );
    expect(source).toContain("eq(generalActionAssets.generalActionId, input.generalActionId)");
    expect(source).toContain("eq(generalActionAssets.assetId, input.assetId)");
  });

  it("collapses a re-point that would collide with an existing pair", () => {
    // The stale row is deleted rather than duplicated onto the target.
    expect(source).toContain("tx.delete(generalActionAssets)");
    expect(source).toContain("eq(generalActionAssets.assetId, input.toAssetId)");
  });

  it("orders link reads oldest-first with an id tiebreak, matching the in-memory store", () => {
    expect(source).toContain("asc(generalActionAssets.createdAt), asc(generalActionAssets.id)");
  });
});
