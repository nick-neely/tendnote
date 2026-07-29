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
  shellBudgetMs: 100,
  frameIntervalMs: 16.7,
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

function margins(dir: string, records: Record<string, unknown>[] = [SAMPLE]): string {
  const path = join(dir, "diagnostics.jsonl");
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return execFileSync(process.execPath, [script, path, "--format=margins"], { encoding: "utf8" });
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

  it("reports how much headroom a passing row had", () => {
    // The gap #331 named: the harness only ever *reported* a measurement when it
    // breached, so "passed at 40 ms" and "passed at 99 ms" looked identical and
    // drift was invisible until the day it broke.
    const output = summarise(runDirectory());

    expect(output).toContain("Margin");
    expect(output).toContain("+78 ms");
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

/**
 * The machine-readable half, which exists because the human half cannot be
 * retrieved (#331).
 *
 * `$GITHUB_STEP_SUMMARY` is only reachable through the web UI, and traces upload
 * on failure only, so a green run left no durable record of its margin. These
 * lines go to the job log, which is retrievable, greppable, and kept with the
 * run — so the question "has this row been losing headroom" has an answer
 * without re-running anything.
 */
describe("Instant diagnostics margins", () => {
  it("emits one greppable JSON record per row", () => {
    const output = margins(runDirectory());
    const lines = output.split("\n").filter((line) => line.startsWith("INSTANT_MARGIN "));

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0].slice("INSTANT_MARGIN ".length))).toMatchObject({
      project: "desktop-chromium",
      scenario: "desktop Today to People",
      ackMs: 22,
      shellBudgetMs: 100,
      ackMarginMs: 78,
      shellMarginMs: 78,
      frameIntervalMs: 16.7,
    });
  });

  it("reports a breach as a negative margin rather than omitting it", () => {
    // The reading that started this: 104 ms against a 100 ms budget. A breach has
    // to appear in the same series as the passes, or the series is a survivorship
    // record rather than a distribution.
    const output = margins(runDirectory(), [{ ...SAMPLE, acknowledgementMs: 104, shellMs: 104 }]);

    expect(
      JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)),
    ).toMatchObject({ ackMarginMs: -4, shellMarginMs: -4 });
  });

  it("reports no margin for a record that carries no budget", () => {
    // Payload diagnostics and the `instant()` contract pass record no gated
    // timing. A zero margin against a zero reading would look like a row sitting
    // exactly on its budget, which is the one thing this must never claim.
    const output = margins(runDirectory(), [
      {
        ...SAMPLE,
        scenario: "cold load: Today",
        acknowledgementMs: null,
        shellMs: 0,
        shellBudgetMs: undefined,
        frameIntervalMs: undefined,
      },
    ]);

    expect(
      JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)),
    ).toMatchObject({ shellBudgetMs: null, shellMarginMs: null, ackMarginMs: null });
  });

  it("refuses a format it does not know rather than printing the wrong one", () => {
    const dir = runDirectory();
    expect(() =>
      execFileSync(process.execPath, [script, join(dir, "diagnostics.jsonl"), "--format=csv"], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
  });
});
