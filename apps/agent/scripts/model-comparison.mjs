import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const appRoot = process.cwd();
const defaultEvalDatabaseUrl = "postgres://tendnote:tendnote@localhost:55432/tendnote_eval";
const outputPath =
  process.env.TENDNOTE_MODEL_COMPARISON_OUT ??
  join(appRoot, ".eve/evals/model-comparison/summary.json");

function listFromEnv(name, fallback) {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasCredentialHint() {
  if (hasValue(process.env.AI_GATEWAY_API_KEY) || hasValue(process.env.VERCEL_OIDC_TOKEN)) {
    return true;
  }
  if (!existsSync(join(appRoot, ".env.local"))) return false;

  const localEnv = readFileSync(join(appRoot, ".env.local"), "utf8");
  return localEnv.split("\n").some((line) => {
    const match = line.match(/^(AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN)=(.*)$/);
    return match ? hasValue(match[2]) : false;
  });
}

function hasValue(value) {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== '""' && trimmed !== "''";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? appRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout}\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}${detail}`);
  }

  return result.stdout ?? "";
}

function parseJsonOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find JSON object in eval output:\n${output}`);
  }
  return JSON.parse(output.slice(start, end + 1));
}

function summarizeEvalJson(json) {
  const evals = json.results ?? [];
  const assertions = evals.flatMap((result) => result.assertions ?? []);
  const judgeAssertions = assertions.filter((assertion) => assertion.name.startsWith("judge."));
  const durationMs =
    Date.parse(json.completedAt ?? "") && Date.parse(json.startedAt ?? "")
      ? Date.parse(json.completedAt) - Date.parse(json.startedAt)
      : null;
  const tokenUsage = evals.reduce(
    (total, result) => {
      for (const event of result.result?.events ?? []) {
        const usage = event.data?.usage;
        if (!usage) continue;
        total.inputTokens += usage.inputTokens ?? 0;
        total.outputTokens += usage.outputTokens ?? 0;
        total.cacheReadTokens += usage.cacheReadTokens ?? 0;
        total.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      }
      return total;
    },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  const judgeAverage =
    judgeAssertions.length === 0
      ? null
      : judgeAssertions.reduce((sum, assertion) => sum + assertion.score, 0) /
        judgeAssertions.length;

  return {
    passed: json.passed,
    failed: json.failed,
    scored: json.scored,
    skipped: json.skipped,
    errored: json.errored,
    durationMs,
    tokenUsage,
    judgeAssertionCount: judgeAssertions.length,
    judgeAverage,
    categoryBreakdown: summarizeCategoryBreakdown(evals),
  };
}

function summarizeEvalSummaryJson(json) {
  const evals = json.evals ?? [];
  const assertions = evals.flatMap((result) => result.assertions ?? []);
  const judgeAssertions = assertions.filter((assertion) => assertion.name.startsWith("judge."));
  const durationMs =
    Date.parse(json.completedAt ?? "") && Date.parse(json.startedAt ?? "")
      ? Date.parse(json.completedAt) - Date.parse(json.startedAt)
      : null;
  const judgeAverage =
    judgeAssertions.length === 0
      ? null
      : judgeAssertions.reduce((sum, assertion) => sum + assertion.score, 0) /
        judgeAssertions.length;

  return {
    passed: json.passed,
    failed: json.failed,
    scored: json.scored,
    skipped: json.skipped,
    errored: json.errored,
    durationMs,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    judgeAssertionCount: judgeAssertions.length,
    judgeAverage,
    categoryBreakdown: summarizeCategoryBreakdown(evals),
  };
}

function summarizeErroredEval(status, output, error) {
  return {
    passed: 0,
    failed: 0,
    scored: 0,
    skipped: 0,
    errored: 1,
    durationMs: null,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    judgeAssertionCount: 0,
    judgeAverage: null,
    exitStatus: status,
    error,
    outputSnippet: output.slice(0, 2000),
    categoryBreakdown: emptyCategoryBreakdown(),
  };
}

function summarizeCategoryBreakdown(evals) {
  const breakdown = emptyCategoryBreakdown();

  for (const evalResult of evals) {
    const id = evalResult.id ?? "";
    const category = categoryForEval(id);
    const verdict = evalResult.verdict ?? verdictFromAssertions(evalResult.assertions ?? []);
    breakdown[category].total += 1;

    if (verdict === "passed") {
      breakdown[category].passed += 1;
    } else if (verdict === "errored") {
      breakdown[category].errored += 1;
    } else {
      breakdown[category].failed += 1;
    }
  }

  return breakdown;
}

function emptyCategoryBreakdown() {
  return {
    safety: emptyCategoryCounts(),
    behavior: emptyCategoryCounts(),
    quality: emptyCategoryCounts(),
    architecture: emptyCategoryCounts(),
    other: emptyCategoryCounts(),
  };
}

function emptyCategoryCounts() {
  return { total: 0, passed: 0, failed: 0, errored: 0 };
}

function categoryForEval(id) {
  if (id.startsWith("policy/") || id.includes("external-action")) return "safety";
  if (id.startsWith("judged/")) return "quality";
  if (id.startsWith("architecture/")) return "architecture";
  if (id.startsWith("behavior/") || id === "smoke") return "behavior";

  return "other";
}

function verdictFromAssertions(assertions) {
  if (assertions.some((assertion) => assertion.passed === false)) return "failed";

  return "passed";
}

function mergeCategoryBreakdowns(...summaries) {
  const merged = emptyCategoryBreakdown();

  for (const summary of summaries) {
    const breakdown = summary?.categoryBreakdown ?? emptyCategoryBreakdown();
    for (const category of Object.keys(merged)) {
      merged[category].total += breakdown[category]?.total ?? 0;
      merged[category].passed += breakdown[category]?.passed ?? 0;
      merged[category].failed += breakdown[category]?.failed ?? 0;
      merged[category].errored += breakdown[category]?.errored ?? 0;
    }
  }

  return merged;
}

function scoreFromCounts(counts) {
  if (counts.total === 0) return null;

  return counts.passed / counts.total;
}

function scoresForRun(deterministic, judged, architecture) {
  const breakdown = mergeCategoryBreakdowns(deterministic, judged, architecture);
  const executionErrored =
    (deterministic?.errored ?? 0) > 0 ||
    (judged?.errored ?? 0) > 0 ||
    (architecture?.errored ?? 0) > 0;

  return {
    safetyScore: scoreFromCounts(breakdown.safety),
    behaviorScore: scoreFromCounts(breakdown.behavior),
    qualityScore: scoreFromCounts(breakdown.quality),
    architectureScore: scoreFromCounts(breakdown.architecture),
    categoryBreakdown: breakdown,
    executionErrored,
    hardFailed:
      executionErrored ||
      breakdown.safety.failed > 0 ||
      breakdown.safety.errored > 0 ||
      breakdown.behavior.failed > 0 ||
      breakdown.behavior.errored > 0,
  };
}

function findLatestEvalSummary(startedMs) {
  const evalsDir = join(appRoot, ".eve/evals");
  if (!existsSync(evalsDir)) return null;

  const candidates = readdirSync(evalsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(evalsDir, entry.name, "summary.json"))
    .filter((summaryPath) => existsSync(summaryPath))
    .map((summaryPath) => ({ summaryPath, mtimeMs: statSync(summaryPath).mtimeMs }))
    .filter((candidate) => candidate.mtimeMs >= startedMs - 10_000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.summaryPath ?? null;
}

function runEval(tag, env, strict) {
  const args = ["exec", "eve", "eval", "--tag", tag, "--skip-report", "--json"];
  if (strict) args.push("--strict");
  const startedMs = Date.now();
  const result = spawnSync("pnpm", args, {
    cwd: appRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

  try {
    return {
      summary: {
        ...summarizeEvalJson(parseJsonOutput(output)),
        exitStatus: result.status,
      },
      failedCommand: result.status !== 0,
    };
  } catch (error) {
    const summaryPath = findLatestEvalSummary(startedMs);
    if (summaryPath) {
      try {
        return {
          summary: {
            ...summarizeEvalSummaryJson(JSON.parse(readFileSync(summaryPath, "utf8"))),
            exitStatus: result.status,
            recoveredFrom: summaryPath,
            recoveryReason: error instanceof Error ? error.message : String(error),
          },
          failedCommand: result.status !== 0,
        };
      } catch {
        // Fall through to the original parse error summary.
      }
    }

    return {
      summary: summarizeErroredEval(
        result.status,
        output,
        error instanceof Error ? error.message : String(error),
      ),
      failedCommand: true,
    };
  }
}

function completedRunKey(run) {
  return `${run.agentModel}\n${run.judgeModel}`;
}

function emptySummary() {
  return {
    generatedAt: new Date().toISOString(),
    agentModels,
    judgeModels,
    subagentModelEnv,
    runs: [],
  };
}

function loadExistingSummary() {
  if (!existsSync(outputPath)) return emptySummary();

  try {
    const summary = JSON.parse(readFileSync(outputPath, "utf8"));
    if (!Array.isArray(summary.runs)) return emptySummary();

    return {
      ...emptySummary(),
      ...summary,
      generatedAt: new Date().toISOString(),
      agentModels,
      judgeModels,
      subagentModelEnv,
      runs: summary.runs,
    };
  } catch {
    return emptySummary();
  }
}

function writeSummary(summary) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({ ...summary, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

const agentModels = listFromEnv(
  "TENDNOTE_MODEL_COMPARISON_AGENT_MODELS",
  process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-sonnet-5",
);
const judgeModels = listFromEnv(
  "TENDNOTE_MODEL_COMPARISON_JUDGE_MODELS",
  process.env.TENDNOTE_JUDGE_MODEL ?? "openai/gpt-5.4-mini",
);
const subagentModelEnv = {
  relationshipStrategistModel: process.env.TENDNOTE_RELATIONSHIP_STRATEGIST_MODEL ?? null,
  messageDrafterModel: process.env.TENDNOTE_MESSAGE_DRAFTER_MODEL ?? null,
  memoryCuratorModel: process.env.TENDNOTE_MEMORY_CURATOR_MODEL ?? null,
};

if (!hasCredentialHint()) {
  console.log("Skipping model-comparison Eve evals: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.");
  process.exit(0);
}

const summary = loadExistingSummary();
const completedRunKeys = new Set(
  summary.runs.filter((run) => run.architecture).map(completedRunKey),
);

for (const agentModel of agentModels) {
  for (const judgeModel of judgeModels) {
    const runKey = `${agentModel}\n${judgeModel}`;
    if (completedRunKeys.has(runKey)) {
      console.log(`Skipping completed evals for agent=${agentModel} judge=${judgeModel}`);
      continue;
    }

    const env = {
      ...process.env,
      TENDNOTE_AGENT_MODEL: agentModel,
      TENDNOTE_JUDGE_MODEL: judgeModel,
    };
    const evalEnv = {
      ...env,
      DATABASE_URL: process.env.TENDNOTE_EVAL_DATABASE_URL ?? defaultEvalDatabaseUrl,
    };

    console.log(`Preparing eval database for agent=${agentModel} judge=${judgeModel}`);
    run("pnpm", ["eval:prepare"], { env });

    console.log(`Running deterministic evals for agent=${agentModel}`);
    const deterministic = runEval("deterministic", evalEnv, true);

    console.log(`Running judged evals for agent=${agentModel} judge=${judgeModel}`);
    const judged = runEval("judged", evalEnv, false);

    console.log(`Running architecture evals for agent=${agentModel}`);
    const architecture = runEval("architecture", evalEnv, false);
    const scores = scoresForRun(deterministic.summary, judged.summary, architecture.summary);

    summary.runs.push({
      agentModel,
      judgeModel,
      subagentModels: {
        relationshipStrategist: subagentModelEnv.relationshipStrategistModel ?? agentModel,
        messageDrafter: subagentModelEnv.messageDrafterModel ?? agentModel,
        memoryCurator: subagentModelEnv.memoryCuratorModel ?? agentModel,
      },
      deterministic: deterministic.summary,
      judged: judged.summary,
      architecture: architecture.summary,
      scores,
      failedCommand: scores.hardFailed,
      commandFailed:
        deterministic.failedCommand || judged.failedCommand || architecture.failedCommand,
    });
    completedRunKeys.add(runKey);
    writeSummary(summary);
  }
}

writeSummary(summary);
console.log(`Wrote model comparison summary to ${outputPath}`);
