import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const assertions = json.results.flatMap((result) => result.assertions ?? []);
  const judgeAssertions = assertions.filter((assertion) => assertion.name.startsWith("judge."));
  const durationMs =
    Date.parse(json.completedAt ?? "") && Date.parse(json.startedAt ?? "")
      ? Date.parse(json.completedAt) - Date.parse(json.startedAt)
      : null;
  const tokenUsage = json.results.reduce(
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
  };
}

function runEval(tag, env, strict) {
  const args = ["exec", "eve", "eval", "--tag", tag, "--skip-report", "--json"];
  if (strict) args.push("--strict");
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

const agentModels = listFromEnv(
  "TENDNOTE_MODEL_COMPARISON_AGENT_MODELS",
  process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5",
);
const judgeModels = listFromEnv(
  "TENDNOTE_MODEL_COMPARISON_JUDGE_MODELS",
  process.env.TENDNOTE_JUDGE_MODEL ?? "openai/gpt-5.4-mini",
);

if (!hasCredentialHint()) {
  console.log("Skipping model-comparison Eve evals: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.");
  process.exit(0);
}

const runs = [];

for (const agentModel of agentModels) {
  for (const judgeModel of judgeModels) {
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

    runs.push({
      agentModel,
      judgeModel,
      deterministic: deterministic.summary,
      judged: judged.summary,
      failedCommand: deterministic.failedCommand || judged.failedCommand,
    }); 
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  agentModels,
  judgeModels,
  runs,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote model comparison summary to ${outputPath}`);
