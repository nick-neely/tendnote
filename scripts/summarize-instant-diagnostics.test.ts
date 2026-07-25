import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "summarize-instant-diagnostics.mjs");

const SAMPLE = {
  scenario: "desktop Today to People",
  project: "desktop-chromium",
  temperature: "cold",
  acknowledgementMs: 22,
  shellMs: 22,
  completeMs: 372,
  stableMs: 90,
  cumulativeLayoutShift: 0,
  rscResponses: 2,
  rscBytes: 1024,
  requestFanOut: 16,
};

/** One run's artifact directory: diagnostics, and optionally its coverage note. */
function runDirectory(uncovered?: { project: string; reason: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "instant-summary-"));
  writeFileSync(join(dir, "diagnostics.jsonl"), `${JSON.stringify(SAMPLE)}\n`);
  if (uncovered) {
    writeFileSync(join(dir, "uncovered-engines.jsonl"), `${JSON.stringify(uncovered)}\n`);
  }
  return dir;
}

function summarise(dir: string, from = script): string {
  return execFileSync(process.execPath, [from, join(dir, "diagnostics.jsonl")], {
    encoding: "utf8",
  });
}

/**
 * A copy of the script in a throwaway tree, with a decoy coverage note at the
 * default location it resolves relative to itself.
 *
 * Copying rather than pointing at the real repository is what makes the
 * regression test deterministic: the decoy has to exist for "ignores the default
 * path" to mean anything, and it must not be a file in the working tree.
 */
function scriptWithDecoyDefault(decoy: { project: string; reason: string }): string {
  const root = mkdtempSync(join(tmpdir(), "instant-summary-root-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "apps/web/.instant"), { recursive: true });
  writeFileSync(join(root, "apps/web/.instant/diagnostics.jsonl"), `${JSON.stringify(SAMPLE)}\n`);
  writeFileSync(
    join(root, "apps/web/.instant/uncovered-engines.jsonl"),
    `${JSON.stringify(decoy)}\n`,
  );

  const copied = join(root, "scripts/summarize-instant-diagnostics.mjs");
  copyFileSync(script, copied);
  return copied;
}

/**
 * The summariser is what a reviewer reads instead of the raw JSONL, and it is
 * run against archived diagnostics as well as the latest ones — `[path-to-jsonl]`
 * exists for exactly that. So the two halves of a run's artifacts have to move
 * together: a table from one run captioned with another run's engine coverage is
 * worse than no caption, because it reads as a fact about the run above it.
 */
describe("Instant diagnostics summariser", () => {
  it("summarises the diagnostics it was given", () => {
    const output = summarise(runDirectory());

    expect(output).toContain("desktop-chromium");
    expect(output).toContain("desktop Today to People");
  });

  it("reports the uncovered engines of the run it is summarising", () => {
    const output = summarise(
      runDirectory({ project: "promotion-webkit", reason: "WebKit is NOT covered by this run." }),
    );

    expect(output).toContain("Engines NOT covered by this run");
    expect(output).toContain("promotion-webkit");
    expect(output).toContain("WebKit is NOT covered by this run.");
  });

  it("does not borrow the default location's uncovered engines", () => {
    // The bug this pins: reading the coverage note from a fixed repository path
    // rather than from beside the diagnostics being summarised. Re-summarising
    // an archived run where every engine executed must produce no caption at
    // all, even while the default location records a skip from a later run.
    const from = scriptWithDecoyDefault({
      project: "promotion-webkit",
      reason: "WebKit is NOT covered by this run.",
    });
    const output = summarise(runDirectory(), from);

    expect(output).toContain("desktop Today to People");
    expect(output).not.toContain("Engines NOT covered by this run");
    expect(output).not.toContain("promotion-webkit");
  });

  it("still reads the default location when no path is given", () => {
    const from = scriptWithDecoyDefault({
      project: "promotion-webkit",
      reason: "WebKit is NOT covered by this run.",
    });
    const output = execFileSync(process.execPath, [from], { encoding: "utf8" });

    expect(output).toContain("Engines NOT covered by this run");
    expect(output).toContain("promotion-webkit");
  });
});
