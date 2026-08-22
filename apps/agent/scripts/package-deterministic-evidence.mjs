import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const SHA = /^[0-9a-f]{40}$/;

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error(`Missing required option ${name}.`);
  return result;
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function reportDirectories(evalRoot) {
  return readdirSync(evalRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(evalRoot, entry.name))
    .filter((path) => statSync(join(path, "summary.json"), { throwIfNoEntry: false }))
    .sort((left, right) =>
      String(json(join(left, "summary.json")).startedAt).localeCompare(
        String(json(join(right, "summary.json")).startedAt),
      ),
    );
}

function countJsonl(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function junitCounts(xml) {
  const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)];
  if (suites.length !== 1) throw new Error("JUnit report must contain exactly one testsuite.");
  const suite = suites[0][0];
  const number = (name) => Number(suite.match(new RegExp(`${name}="(\\d+)"`))?.[1]);
  const ids = [...xml.matchAll(/<testcase\b[^>]*\bname="([^"]+)"/g)].map((match) => match[1]);
  return { tests: number("tests"), failures: number("failures"), skipped: number("skipped"), ids };
}

export function buildEvidenceMetadata({
  sourceCommit,
  workflowUrl,
  command,
  agentModel,
  exitCode,
  reports,
  resultRows,
  junit,
  packagedAt,
}) {
  const initial = reports[0];
  if (!initial)
    throw new Error("No initial eval report was produced; this is a bootstrap failure.");
  const counts = {
    passed: Number(initial.passed ?? 0),
    failed: Number(initial.failed ?? 0),
    skipped: Number(initial.skipped ?? 0),
    errored: Number(initial.errored ?? 0),
    total: Number(initial.totalEvals ?? initial.evals?.length ?? 0),
  };
  const runtime = observedRuntimeIdentity(reports, agentModel);
  const machineCounts = jsonlCounts(resultRows[0] ?? []);
  const evalIds = idsOf(initial.evals);
  const rowIds = idsOf(resultRows[0] ?? []);
  const junitIds = Array.isArray(junit.ids) ? junit.ids : [];
  const idSetsAgree =
    uniqueIds(evalIds) &&
    uniqueIds(rowIds) &&
    uniqueIds(junitIds) &&
    sameIdSet(evalIds, rowIds) &&
    sameIdSet(evalIds, junitIds) &&
    evalIds.length === counts.total;
  const summaryStatuses = statusCounts((initial.evals ?? []).map((entry) => entry?.result?.status));
  const retryRounds = Math.max(0, reports.length - 1);
  const clean =
    exitCode === 0 &&
    counts.total > 0 &&
    counts.passed === counts.total &&
    counts.failed === 0 &&
    counts.skipped === 0 &&
    counts.errored === 0 &&
    retryRounds === 0 &&
    machineCounts.total === counts.total &&
    machineCounts.passed === counts.passed &&
    machineCounts.failed === counts.failed &&
    machineCounts.skipped === counts.skipped &&
    machineCounts.errored === counts.errored &&
    JSON.stringify(machineCounts.statuses) === JSON.stringify(summaryStatuses) &&
    idSetsAgree &&
    junit.tests === counts.total &&
    junit.failures === 0 &&
    junit.skipped === 0;

  return {
    schemaVersion: 1,
    suite: "deterministic",
    sourceCommit,
    workflow: { trigger: "workflow_dispatch", url: workflowUrl, command },
    configuration: {
      agentModel: runtime.modelId,
      eveVersion: runtime.eveVersion,
      database: "fresh reset, committed migrations, and synthetic seed before every sample",
    },
    timestamps: {
      startedAt: initial.startedAt,
      completedAt: reports.at(-1)?.completedAt,
      packagedAt,
    },
    counts,
    evalIds,
    statuses: machineCounts.statuses,
    retry: { attempted: retryRounds > 0, rounds: retryRounds },
    exitCode,
    clean,
  };
}

function statusCounts(statuses) {
  const counts = {};
  for (const status of statuses) {
    if (typeof status !== "string" || status.length === 0) {
      throw new Error("Summary eval has no result status.");
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function idsOf(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => entry?.id);
}

function uniqueIds(ids) {
  return (
    ids.length > 0 &&
    ids.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length
  );
}

function sameIdSet(left, right) {
  return (
    uniqueIds(left) &&
    uniqueIds(right) &&
    left.length === right.length &&
    left.every((id) => right.includes(id))
  );
}

export function observedRuntimeIdentity(reports, expectedModel) {
  const identities = reports.flatMap((report) =>
    (report.evals ?? []).flatMap((entry) =>
      (entry.result?.events ?? [])
        .filter((event) => event?.type === "session.started")
        .map((event) => event?.data?.runtime)
        .filter(Boolean),
    ),
  );
  if (identities.length === 0) throw new Error("No session.started runtime identity was observed.");
  const distinct = new Set(
    identities.map((identity) => `${identity.modelId ?? ""}\0${identity.eveVersion ?? ""}`),
  );
  if (distinct.size !== 1) throw new Error("Multiple runtime identities were observed.");
  const identity = identities[0];
  if (!identity.modelId || identity.modelId !== expectedModel) {
    throw new Error(`Observed model ${identity.modelId ?? "missing"}, expected ${expectedModel}.`);
  }
  return { modelId: identity.modelId, eveVersion: identity.eveVersion ?? null };
}

export function jsonlCounts(rows) {
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    total: rows.length,
    statuses: {},
  };
  for (const row of rows) {
    if (!["passed", "failed", "skipped", "errored"].includes(row?.verdict)) {
      throw new Error(`Unknown JSONL verdict: ${row?.verdict ?? "missing"}.`);
    }
    counts[row.verdict] += 1;
    if (typeof row.status !== "string" || row.status.length === 0) {
      throw new Error("JSONL result has no status.");
    }
    counts.statuses[row.status] = (counts.statuses[row.status] ?? 0) + 1;
  }
  return counts;
}

function readme(metadata) {
  const result = metadata.clean
    ? "CLEAN — every selected case passed its first sample."
    : "BLOCKED — this run is not clean publication evidence.";
  return `# Eve deterministic evaluation — ${metadata.timestamps.completedAt?.slice(0, 10) ?? "unknown date"}\n\n## Result\n\n**${result}**\n\n| Field | Value |\n| --- | --- |\n| Source commit | \`${metadata.sourceCommit}\` |\n| Workflow | ${metadata.workflow.url} |\n| Trigger | \`${metadata.workflow.trigger}\` |\n| Command | \`${metadata.workflow.command}\` |\n| Execution window | ${metadata.timestamps.startedAt}–${metadata.timestamps.completedAt} |\n| Agent model | \`${metadata.configuration.agentModel}\` |\n| Eve version | \`${metadata.configuration.eveVersion ?? "unknown"}\` |\n| Counts | ${metadata.counts.passed} passed, ${metadata.counts.failed} failed, ${metadata.counts.skipped} skipped, ${metadata.counts.errored} errored, ${metadata.counts.total} total |\n| Retry status | ${metadata.retry.attempted ? `${metadata.retry.rounds} retry round(s); not clean` : "No retry; first sample only"} |\n| Wrapper exit code | ${metadata.exitCode} |\n\nMachine-readable details are in \`metadata.json\`, \`junit.xml\`, and \`raw/\`. Verify every preserved file with \`sha256sum -c SHA256SUMS\`. Workflow artifacts supplement this repository bundle; they do not replace it.\n`;
}

export function main() {
  const sourceCommit = required("--source-sha");
  if (!SHA.test(sourceCommit)) throw new Error("--source-sha must be a full lowercase commit SHA.");
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
  const actual = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).stdout.trim();
  if (actual !== sourceCommit)
    throw new Error(`Checked out ${actual}, not requested candidate ${sourceCommit}.`);

  const evalRoot = resolve(repoRoot, value("--eval-root") ?? "apps/agent/.eve/evals");
  const output = resolve(repoRoot, value("--output") ?? `evidence/evals/${sourceCommit}`);
  const exitCode = Number(readFileSync(required("--exit-code-file"), "utf8").trim());
  const explicitReport = value("--report-dir");
  const dirs = explicitReport ? [resolve(repoRoot, explicitReport)] : reportDirectories(evalRoot);
  const reports = dirs.map((dir) => json(join(dir, "summary.json")));
  const resultRows = dirs.map((dir) => jsonl(join(dir, "results.jsonl")));
  const junitSource = join(evalRoot, "junit.xml");
  const junit = junitCounts(readFileSync(junitSource, "utf8"));
  const metadata = buildEvidenceMetadata({
    sourceCommit,
    workflowUrl: required("--workflow-url"),
    command: required("--command"),
    agentModel: required("--agent-model"),
    exitCode,
    reports,
    resultRows,
    junit,
    packagedAt: new Date().toISOString(),
  });

  mkdirSync(join(output, "raw"), { recursive: true });
  copyFileSync(junitSource, join(output, "junit.xml"));
  dirs.forEach((dir, index) => {
    const label = index === 0 ? "initial" : `retry-${index}`;
    const summary = join(dir, "summary.json");
    const results = join(dir, "results.jsonl");
    if (!statSync(results, { throwIfNoEntry: false }))
      throw new Error(`${label} has no results.jsonl.`);
    if (
      countJsonl(results) !== Number(reports[index].totalEvals ?? reports[index].evals?.length ?? 0)
    ) {
      throw new Error(`${label} JSONL count disagrees with its summary.`);
    }
    copyFileSync(summary, join(output, "raw", `${label}-summary.json`));
    copyFileSync(results, join(output, "raw", `${label}-results.jsonl`));
  });
  writeFileSync(join(output, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(output, "README.md"), readme(metadata));

  const files = [
    "README.md",
    "junit.xml",
    "metadata.json",
    ...readdirSync(join(output, "raw"))
      .sort()
      .map((name) => `raw/${name}`),
  ];
  writeFileSync(
    join(output, "SHA256SUMS"),
    `${files.map((name) => `${sha256(join(output, name))}  ${name}`).join("\n")}\n`,
  );
  process.stdout.write(`${output}\n`);
  if (!metadata.clean) throw new Error("Deterministic evaluation was not first-sample clean.");
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
