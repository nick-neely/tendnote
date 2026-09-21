import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { atomicJson, loadCheckpoint, saveCheckpoint } from "../scripts/cost-replay/checkpoint.mjs";
import { createMeter } from "../scripts/cost-replay/meter.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "replay-checkpoint-"));
  dirs.push(root);
  atomicJson(join(root, "metadata.json"), { runId: "run", ceilingUsd: 50, mode: "--heavy" });
  atomicJson(join(root, "ledger.json"), {
    rows: [{ status: "settled", costUsd: 8, reportingWriteUsd: 0.1 }],
  });
  atomicJson(join(root, "attempt.json"), { output: root });
  const args = {
    root,
    day: 12,
    progress: { turns: 240, storage: { unfinishedBackgroundJobs: 0 } },
    fixture: { start: "2026-09-20T12:00:00Z", persons: [{ id: "stable-person" }] },
    dump: () => Buffer.from("database at 240"),
    ledgerRows: [{ status: "settled", costUsd: 8, reportingWriteUsd: 0.1 }],
    runId: "run",
    source: "old-source",
  };
  return { root, args };
}
it("restores the checkpoint, fixed clock and identities but retains costs incurred after it", () => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  atomicJson(join(root, "ledger.json"), {
    rows: [...args.ledgerRows, { status: "settled", costUsd: 2, reportingWriteUsd: 0.1 }],
  });
  const loaded = loadCheckpoint(root);
  expect(loaded.checkpoint.day).toBe(12);
  expect(loaded.checkpoint.fixture).toEqual(args.fixture);
  expect(loaded.bytes.toString()).toBe("database at 240");
  expect(
    createMeter({ ceilingUsd: 49.995, initialRows: loaded.rows, persist() {} }).snapshot()
      .accountedSpendUsd,
  ).toBe(10.2);
});
it("keeps the old checkpoint if the next snapshot fails", () => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  expect(() =>
    saveCheckpoint({
      ...args,
      day: 13,
      progress: { turns: 260, storage: { unfinishedBackgroundJobs: 0 } },
      dump: () => {
        throw new Error("disk full");
      },
    }),
  ).toThrow("disk full");
  expect(loadCheckpoint(root).checkpoint.day).toBe(12);
});
it.each(["reserved", "uncertain"])("refuses a resume with %s billing", (status) => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  atomicJson(join(root, "ledger.json"), { rows: [{ status, reservationUsd: 3 }] });
  expect(() => loadCheckpoint(root)).toThrow("settled");
});
it("refuses a corrupt database snapshot before restore", () => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  writeFileSync(join(root, loadCheckpoint(root).checkpoint.databaseFile), "damaged");
  expect(() => loadCheckpoint(root)).toThrow("digest");
});
it("refuses unfinished work and incomplete day boundaries", () => {
  const { args } = fixture();
  expect(() =>
    saveCheckpoint({ ...args, progress: { turns: 239, storage: { unfinishedBackgroundJobs: 0 } } }),
  ).toThrow("complete");
  expect(() =>
    saveCheckpoint({ ...args, progress: { turns: 240, storage: { unfinishedBackgroundJobs: 1 } } }),
  ).toThrow("quiescent");
});
it("cannot replenish the budget by resuming", async () => {
  const call = vi.fn();
  const meter = createMeter({
    ceilingUsd: 49.995,
    initialRows: [{ status: "settled", costUsd: 48, reportingWriteUsd: 0.2 }],
    persist() {},
  });
  await expect(meter.run({}, 2, call)).rejects.toThrow("budget");
  expect(call).not.toHaveBeenCalled();
});
it("refuses workload drift and mismatched attempt identity", () => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  const data = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
  data.contract.workload.turns = 601;
  atomicJson(join(root, "latest.json"), data);
  expect(() => loadCheckpoint(root)).toThrow("incompatible");
  saveCheckpoint(args);
  atomicJson(join(root, "metadata.json"), { runId: "another", ceilingUsd: 50, mode: "--heavy" });
  expect(() => loadCheckpoint(root)).toThrow("identity");
});

it("restarts after a failed day from the newest snapshot, without rerunning completed days", async () => {
  const { runHeavyDays } = await import("../scripts/cost-replay/heavy.mjs");
  const { root, args } = fixture();
  saveCheckpoint(args);
  let databaseTurns = 240;
  const visited = [];
  let failDay = 13;
  const proxy = {
    meter: createMeter({
      ceilingUsd: 49.995,
      initialRows: loadCheckpoint(root).rows,
      persist() {},
    }),
  };
  const run = async (_command, _args, _cwd, env) => {
    const day = Number(env.TENDNOTE_COST_DAY);
    visited.push(day);
    const input = JSON.parse(readFileSync(env.TENDNOTE_COST_PROGRESS, "utf8"));
    expect(input.turns).toBe(day * 20);
    expect(databaseTurns).toBe(input.turns);
    expect(JSON.parse(readFileSync(env.TENDNOTE_COST_FIXTURE, "utf8"))).toEqual(args.fixture);
    if (day === failDay) {
      databaseTurns++;
      throw new Error("session unavailable after mutation");
    }
    databaseTurns += 20;
    atomicJson(join(root, "heavy.json"), {
      turns: databaseTurns,
      status: day === 29 ? "complete" : "checkpoint-ready",
      storage: { unfinishedBackgroundJobs: 0 },
    });
  };
  const options = {
    app: root,
    workspace: root,
    output: root,
    env: {},
    source: "fixed-source",
    runId: "run",
    root,
    proxy,
    run,
    createWorkspace() {},
    archive: { assertQuiescent() {}, dump: () => Buffer.from(String(databaseTurns)) },
  };
  await expect(runHeavyDays({ ...options, history: loadCheckpoint(root) })).rejects.toThrow(
    "session unavailable",
  );
  expect(visited).toEqual([12, 13]);
  const resume = loadCheckpoint(root);
  expect(resume.checkpoint.day).toBe(13);
  databaseTurns = Number(resume.bytes.toString()); // Restore, discarding only the failed partial day.
  failDay = -1;
  await runHeavyDays({ ...options, history: resume });
  expect(visited).toEqual([12, 13, ...Array.from({ length: 17 }, (_, i) => i + 13)]);
  expect(loadCheckpoint(root).checkpoint.progress.turns).toBe(600);
});

it("refuses a truncated paid ledger and retains fees for earlier report queries", () => {
  const { root, args } = fixture();
  saveCheckpoint(args);
  atomicJson(join(root, "provider-report.json"), { status: 200 });
  expect(loadCheckpoint(root).reportQuerySpendUsd).toBe(0.005);
  atomicJson(join(root, "ledger.json"), { rows: [] });
  expect(() => loadCheckpoint(root)).toThrow("truncated");
});

it("refuses publication when the post-exit database check finds work missed by the eval", async () => {
  const { runHeavyDays } = await import("../scripts/cost-replay/heavy.mjs");
  const { root, args } = fixture();
  saveCheckpoint(args);
  const dump = vi.fn();
  await expect(
    runHeavyDays({
      app: root,
      workspace: root,
      output: root,
      env: {},
      source: "fixed",
      runId: "run",
      root,
      history: loadCheckpoint(root),
      createWorkspace() {},
      proxy: {
        meter: createMeter({ ceilingUsd: 49.995, initialRows: args.ledgerRows, persist() {} }),
      },
      run: async () =>
        atomicJson(join(root, "heavy.json"), {
          turns: 260,
          status: "checkpoint-ready",
          storage: { unfinishedBackgroundJobs: 0 },
        }),
      archive: {
        dump,
        assertQuiescent() {
          throw new Error("unfinished jobs after child exit");
        },
      },
    }),
  ).rejects.toThrow("unfinished jobs after child exit");
  expect(dump).not.toHaveBeenCalled();
  expect(loadCheckpoint(root).checkpoint.day).toBe(12);
});
