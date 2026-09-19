import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { completedEval, runProcess } from "../scripts/cost-replay/process.mjs";

describe("isolated cost replay lifecycle", () => {
  it("reaps a lingering child only after its completed passing eval artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cost-process-test-"));
    try {
      const file = join(dir, "result.xml");
      const code = `require('node:fs').writeFileSync(${JSON.stringify(file)}, '<testsuite tests="1" failures="0" skipped="0"></testsuite>'); setInterval(() => {}, 100);`;
      await runProcess(process.execPath, ["-e", code], {
        cwd: dir,
        env: { PATH: process.env.PATH },
        completionFile: file,
        timeoutMs: 5000,
      });
      expect(completedEval(file)).toBe(true);
      writeFileSync(file, '<testsuite tests="1" failures="1"></testsuite>');
      expect(completedEval(file)).toBe(false);
      writeFileSync(file, '<testsuite tests="1" failures="0" skipped="1"></testsuite>');
      expect(completedEval(file)).toBe(false);
      writeFileSync(file, '<testsuite tests="1"');
      expect(completedEval(file)).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("fails on subprocess errors and timeouts", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "process.exit(2)"], { env: {}, timeoutMs: 5000 }),
    ).rejects.toThrow("failed");
    await expect(
      runProcess(process.execPath, ["-e", "setInterval(() => {}, 100)"], {
        env: {},
        timeoutMs: 100,
      }),
    ).rejects.toThrow("timed out");
  });
  it("blocks external fetches before reaching the network", () => {
    const preload = resolve("scripts/cost-replay/preload.mjs");
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        preload,
        "--input-type=module",
        "-e",
        'try { await fetch("https://example.invalid/"); process.exit(1); } catch (error) { console.log(error.message); }',
      ],
      {
        env: { TENDNOTE_COST_PROXY: "http://127.0.0.1:1", TENDNOTE_COST_PROXY_TOKEN: "test" },
        encoding: "utf8",
      },
    );
    expect(result).toContain("Cost replay blocked external fetch");
  });
  it("refuses paid execution without the separate approval acknowledgement", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/cost-replay/run.mjs", "--paid"], {
        env: { PATH: process.env.PATH },
        stdio: "pipe",
      }),
    ).toThrow("separate owner approval");
  });
});
