import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Consumer-boundary checks (#19): the web profile must consume the shared
 * snapshot-backed read path and must NOT re-implement snapshot generation,
 * freshness, policy filtering, or persistence in the app layer (PRD #11).
 */
const SRC = join(process.cwd(), "src");
const pageSource = readFileSync(join(SRC, "app", "people", "[personId]", "page.tsx"), "utf8");
const viewSource = readFileSync(join(SRC, "lib", "relationship-snapshot-view.ts"), "utf8");
const cardSource = readFileSync(join(SRC, "components", "relationship-snapshot-card.tsx"), "utf8");

describe("web snapshot consumer boundary", () => {
  it("loads the profile through the shared snapshot-backed read path", () => {
    expect(pageSource).toMatch(
      /import\s+\{[^}]*getPersonContextSnapshot[^}]*\}\s+from\s+"@tendnote\/db(\/[\w-]+)*"/s,
    );
    expect(pageSource).toMatch(/getPersonContextSnapshot\(/);
  });

  it("does not duplicate snapshot generation, freshness, or persistence", () => {
    for (const source of [pageSource, viewSource, cardSource]) {
      expect(source).not.toMatch(/generateDeterministicSnapshot|buildSnapshotPrompt/);
      expect(source).not.toMatch(/computeSnapshotFingerprint|upsertContextSnapshot/);
    }
  });

  it("does not re-derive trust policy in the app layer", () => {
    // Trust filtering lives in the shared read path; the page no longer calls the
    // raw getPersonContext seam or re-runs proactive filters for the snapshot.
    expect(pageSource).not.toMatch(/getPersonContext\b(?!Snapshot)/);
    expect(viewSource).not.toMatch(/canUseMemoryProactively|canUseSourceRecordProactively/);
  });
});
