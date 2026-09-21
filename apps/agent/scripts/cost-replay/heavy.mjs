import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicJson, saveCheckpoint } from "./checkpoint.mjs";
import { variants } from "./plan.mjs";
import { createReplayWorkspace } from "./workspace.mjs";

export async function runHeavyDays({
  app,
  workspace,
  output,
  env,
  source,
  runId,
  root,
  history,
  archive,
  proxy,
  run,
  createWorkspace = createReplayWorkspace,
}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  atomicJson(join(root, "attempt.json"), { output });
  const fixtureFile = join(workspace, "fixture.json");
  const progressFile = join(workspace, "checkpoint-progress.json");
  if (history) {
    atomicJson(fixtureFile, history.checkpoint.fixture);
    atomicJson(progressFile, history.checkpoint.progress);
    atomicJson(join(output, "heavy.json"), history.checkpoint.progress);
  }
  for (let day = history?.checkpoint.day ?? 0; day < 30; day++) {
    const childWorkspace = join(workspace, `day-${day + 1}`);
    createWorkspace(app, childWorkspace);
    const junit = join(childWorkspace, "heavy-junit.xml");
    await run(
      "pnpm",
      [
        "exec",
        "eve",
        "eval",
        "cost-replay/month",
        "--strict",
        "--junit",
        junit,
        "--skip-report",
        "--max-concurrency",
        "1",
        "--timeout",
        "86400000",
      ],
      childWorkspace,
      {
        ...env,
        TENDNOTE_COST_VARIANT: "heavy",
        TENDNOTE_COST_WORKLOAD: JSON.stringify(variants.heavy),
        TENDNOTE_COST_DAY: String(day),
        TENDNOTE_COST_FIXTURE: fixtureFile,
        ...(day > 0 ? { TENDNOTE_COST_PROGRESS: progressFile } : {}),
      },
      junit,
    );
    // runProcess has reaped the entire child group: old sessions cannot write
    // after this snapshot, and their live stream listeners cannot accumulate.
    await proxy.meter.idle();
    const ledger = proxy.meter.snapshot();
    if (
      ledger.stopped ||
      ledger.pendingRequests ||
      ledger.rows.some((row) => row.status !== "settled")
    )
      throw new Error("Day stopped or has unsettled billing; no checkpoint published");
    atomicJson(join(output, "ledger.json"), { simulated: false, ...ledger });
    const progress = JSON.parse(readFileSync(join(output, "heavy.json"), "utf8"));
    if (progress.status !== (day === 29 ? "complete" : "checkpoint-ready"))
      throw new Error("Day did not reach a checkpoint boundary");
    const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
    archive.assertQuiescent();
    saveCheckpoint({
      root,
      day: day + 1,
      progress,
      fixture,
      dump: archive.dump,
      ledgerRows: ledger.rows,
      runId,
      source,
    });
    atomicJson(progressFile, progress);
    console.log(`Heavy checkpoint durable: day ${day + 1}/30, ${progress.turns}/600 turns`);
  }
}
