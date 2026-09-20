import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerReplayInterrupt } from "./interrupt.mjs";
import {
  assertEvalDatabase,
  ceilingUsd,
  cleanEnvironment,
  models,
  replayScope,
  variants,
} from "./plan.mjs";
import { runProcess } from "./process.mjs";
import { startProxy } from "./proxy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../..");
const repo = resolve(app, "../..");
const args = process.argv.slice(2);
const mode = args[0] ?? "--plan";
if (args.length > 1 || !["--plan", "--smoke", "--paid", "--canary", "--heavy"].includes(mode))
  throw new Error("Use --plan, --smoke, --paid, --canary, or --heavy");
if (mode === "--plan") {
  console.log(
    JSON.stringify(
      {
        canary: replayScope("--canary"),
        heavy: replayScope("--heavy"),
        variants,
        models,
        ceilingUsd,
        ceilingScope: "all three variants combined; no automatic reruns",
        days: 30,
        sessions: "one fresh session per synthetic day",
        uploads: "64 KiB synthetic PDF per upload; storage only",
        schedule: "30 morning agendas, 4 weekly reviews, 30 aftercare checks, 30 birthday checks",
        boundaries:
          "Synthetic local database, in-app writes only, no Google/Discord/email/push delivery",
        paidCommand: "pnpm --filter @tendnote/agent eval:cost --paid",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const paid = ["--paid", "--canary", "--heavy"].includes(mode);
const scope = replayScope(mode);
if (paid && process.env.TENDNOTE_COST_APPROVAL !== scope.approval)
  throw new Error(
    `Paid run requires separate owner approval: TENDNOTE_COST_APPROVAL=${scope.approval}`,
  );
if (paid && !process.env.AI_GATEWAY_API_KEY)
  throw new Error("Paid run requires AI_GATEWAY_API_KEY; ambient OIDC is not used");
const database = assertEvalDatabase(
  process.env.TENDNOTE_EVAL_DATABASE_URL ??
    "postgres://tendnote:tendnote@localhost:55432/tendnote_eval",
);
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
if (paid && execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim())
  throw new Error("Commit the replay source before paid evidence is recorded");
const runId = randomUUID();
const workspace = join(app, ".eve", `cost-replay-${runId}`);
const output = paid
  ? join(
      repo,
      "evidence/cost",
      source,
      ...(mode === "--canary" ? ["heavy-canary"] : mode === "--heavy" ? ["heavy-month"] : []),
    )
  : join(workspace, "evidence");
if (existsSync(output))
  throw new Error("Evidence already exists; never overwrite or silently rerun a paid sample");
mkdirSync(output, { recursive: true });
const write = (name, data) => {
  const target = join(output, name);
  writeFileSync(`${target}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(`${target}.tmp`, target);
};
// Public catalog only. Smoke has a fixed artificial catalog and never calls the Internet.
const catalog = paid
  ? (
      await (
        await fetch("https://ai-gateway.vercel.sh/v1/models", {
          signal: AbortSignal.timeout(30_000),
        })
      ).json()
    ).data
  : Object.values(models).map((id) => ({
      id,
      context_window: 1000000,
      max_tokens: 65536,
      pricing: { input: "0.000001", output: "0.000004" },
    }));
write(
  "catalog.json",
  catalog.filter((item) => Object.values(models).includes(item.id)),
);
const token = randomUUID();
const proxy = await startProxy({
  runId,
  apiKey: paid ? process.env.AI_GATEWAY_API_KEY : undefined,
  token,
  catalog,
  ceilingUsd: scope.ceilingUsd - scope.reportQueryAllowanceUsd,
  simulated: !paid,
  persist: (state) => write("ledger.json", { simulated: !paid, ...state }),
});
const env = {
  ...cleanEnvironment(process.env),
  DATABASE_URL: database,
  TENDNOTE_EVAL_DATABASE_URL: database,
  TENDNOTE_COST_PROXY: proxy.url,
  TENDNOTE_COST_PROXY_TOKEN: token,
  TENDNOTE_COST_DAYS: String(scope.days),
  TENDNOTE_COST_MODE: paid ? "paid" : "smoke",
  TENDNOTE_COST_OUTPUT: output,
  NODE_OPTIONS: `--import=${join(here, "preload.mjs")}`,
};
// This copy has no .env files and no schedules that can race the manual replay.
// Its agent/tools/hooks are otherwise the exact current source and tool surface.
cpSync(join(app, "agent"), join(workspace, "agent"), {
  recursive: true,
  filter: (path) => !path.includes("/schedules"),
});
cpSync(join(app, "evals"), join(workspace, "evals"), { recursive: true });
// No provider-executed web research in this synthetic relationship workload.
writeFileSync(
  join(workspace, "agent/tools/web_search.ts"),
  'import { disableTool } from "eve/tools";\nexport default disableTool();\n',
);
for (const file of ["package.json", "tsconfig.json"])
  cpSync(join(app, file), join(workspace, file));
symlinkSync(join(app, "node_modules"), join(workspace, "node_modules"), "dir");
const metadata = {
  source,
  runId,
  simulated: !paid,
  mode,
  ceilingUsd: scope.ceilingUsd,
  reportQueryAllowanceUsd: scope.reportQueryAllowanceUsd,
  selectedVariants: scope.variants,
  sampleKind: mode === "--canary" ? "heavy-canary" : "month",
  variants,
  models,
  command: `pnpm --filter @tendnote/agent eval:cost ${mode}`,
  startedAt: new Date().toISOString(),
  status: "running",
  assumptions: {
    days: scope.days,
    sessionBoundary: "daily",
    workloadRevision: "capture-contract-v2",
    capturePattern:
      "every fourth capture is confirmed; pair follow-ups only with confirmed captures; remaining follow-ups use non-capture turns",
    uploadBytes: 65536,
    syntheticGoogleConnection: true,
    externalDelivery: false,
    excludedTool: "web_search",
    reportingWriteAllowancePerRequestUsd: paid ? 0.000225 : 0,
    reportingUser: `cost-replay:${runId}`,
    transportPolicy:
      "up to three connection-establishment attempts; no retries after ambiguous failure",
  },
};
write("metadata.json", metadata);
const abort = new AbortController();
function run(command, args, cwd = workspace, childEnv = env, completionFile) {
  return runProcess(command, args, {
    cwd,
    env: childEnv,
    completionFile,
    signal: abort.signal,
    timeoutMs: paid ? 21660000 : 180000,
  });
}
registerReplayInterrupt({ meter: proxy.meter, abort, metadata, write });
try {
  for (const variant of paid ? scope.variants : ["smoke"]) {
    await fetch(`${proxy.url}/phase`, {
      method: "POST",
      headers: { "x-cost-proxy-token": token },
      body: JSON.stringify({ variant, category: "interactive" }),
    });
    // Existing reset has its own database-name guard; ours also refuses remote hosts.
    await run("pnpm", ["eval:prepare"], app);
    await run(
      "pnpm",
      [
        "exec",
        "eve",
        "eval",
        "cost-replay/month",
        "--strict",
        "--junit",
        join(workspace, `${variant}-junit.xml`),
        "--skip-report",
        "--max-concurrency",
        "1",
        "--timeout",
        "21600000",
      ],
      workspace,
      {
        ...env,
        TENDNOTE_COST_VARIANT: variant,
        TENDNOTE_COST_WORKLOAD: JSON.stringify(variants[variant] ?? variants.light),
      },
      join(workspace, `${variant}-junit.xml`),
    );
    if (proxy.meter.snapshot().stopped || proxy.meter.snapshot().pendingRequests)
      throw new Error("Meter stopped or has unsettled requests");
    const result = JSON.parse(readFileSync(join(output, `${variant}.json`), "utf8"));
    if (result.status !== "complete") throw new Error("Workload did not complete");
  }
  metadata.status = paid ? "complete" : "smoke-passed";
} catch (error) {
  metadata.status = "partial";
  metadata.failure = error.message;
  process.exitCode = 1;
} finally {
  write("metadata.json", metadata);
  await proxy.close();
  metadata.finishedAt = new Date().toISOString();
  write("metadata.json", metadata);
  const state = proxy.meter.snapshot();
  write("ledger.json", { simulated: !paid, ...state });
  const table = [];
  for (const variant of [...Object.keys(variants), "smoke"])
    for (const category of ["interactive", "snapshot", "extraction", "embedding", "scheduled"]) {
      const rows = state.rows.filter((row) => row.variant === variant && row.category === category);
      if (rows.length)
        table.push({
          variant,
          category,
          calls: rows.length,
          inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
          outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
          costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
          reportingWriteUsd: rows.reduce(
            (sum, row) => sum + (row.costUsd === undefined ? 0 : row.reportingWriteUsd),
            0,
          ),
          incomplete: rows.some((row) => row.status !== "settled"),
        });
    }
  write("summary.json", { simulated: !paid, status: metadata.status, table });
  writeFileSync(
    join(output, "README.md"),
    `# Cost replay ${paid ? "evidence" : "UNPAID SIMULATION"}\n\nSource: ${source}\n\nStatus: ${metadata.status}. ${paid ? `One ${scope.days}-day sample per selected variant; variance is not measured.` : "Artificial usage and costs. Not pricing evidence."}\n\nCommand: \`${metadata.command}\`\n\nSee metadata.json for configuration, catalog.json for the catalog snapshot, ledger.json for every reservation and settlement, summary.json for category totals, and each variant JSON for completed activity and stored bytes. Partial or uncertain rows are not a complete monthly estimate. knownSpendUsd records response-reported inference cost; reportingWriteUsd is a conservative reporting-fee allowance, not a confirmed charge. accountedSpendUsd includes both plus unsettled reservations. Reconcile provider reporting before treating these as total charged cost. Storage bytes are measured, not priced. Raw prompts and replies are omitted.\n`,
  );
  console.log(`Cost replay ${metadata.status}: ${output}`);
}
