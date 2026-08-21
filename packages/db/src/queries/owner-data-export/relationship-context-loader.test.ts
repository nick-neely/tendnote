import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "relationship-context.ts"), "utf8");

describe("owner relationship context loader contract", () => {
  it("keeps every person-linked family owner-scoped at the canonical read seam", () => {
    expect(source).toContain("eq(people.ownerUserId, ownerUserId)");
    expect(source).toContain("eq(memories.ownerUserId, ownerUserId)");
    expect(source).toContain("eq(interactions.ownerUserId, ownerUserId)");
    expect(source).toContain("eq(followups.ownerUserId, ownerUserId)");
    expect(source).toContain('eq(contextFacts.subjectKind, "self")');
    expect(source).toContain("eq(contextFacts.subjectUserId, ownerUserId)");
  });

  it("does not turn visibility or generated-view tables into export truth", () => {
    expect(source).not.toContain("visibleHouseholdRecordSql");
    expect(source).not.toContain("personContextSnapshots");
    expect(source).not.toContain("relationshipContextEmbeddings");
    expect(source).not.toContain("providerConnections");
    expect(source).not.toContain("listActiveFollowups");
    expect(source).not.toContain('status, "active"');
  });
});
