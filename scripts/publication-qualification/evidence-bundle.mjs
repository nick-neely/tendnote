import { join, relative, resolve, sep } from "node:path";
import {
  COMPLETED,
  COUNT_FIELDS,
  fullSha,
  isRecord,
  METADATA_COUNT_FIELDS,
  PASS,
  sameIdSet,
  sameJson,
  timestamp,
  uniqueStringIds,
} from "./contract.mjs";
import { junitCounts } from "./junit.mjs";
import {
  containedBy,
  describeError,
  parseJson,
  readJsonl,
  secureBundleFiles,
  secureChildPath,
  secureDirectory,
  secureRead,
  sha256,
} from "./secure-fs.mjs";

/**
 * Validate the exact deterministic bundle produced by the Eve evidence
 * packager. This never upgrades a non-clean run: skipped, waiting, retried,
 * stale, mismatched, or partially written data each produce a blocking reason.
 *
 * The bundle states its own counts four times - metadata, raw summary, JSONL
 * rows, and JUnit - and the checks below deliberately re-derive each set and
 * compare them against every other, so no single file can declare the run
 * clean on its own.
 */

const EXPECTED_FILES = Object.freeze([
  "README.md",
  "junit.xml",
  "metadata.json",
  "raw/initial-results.jsonl",
  "raw/initial-summary.json",
]);
const ROW_VERDICTS = ["passed", "failed", "skipped", "errored"];
const NON_CLEAN_FLAGS = ["partial", "recovered", "stale", "waiting"];

function blocked(blockers) {
  return { status: "blocked", blockers, evidence: [] };
}

/** Resolve the bundle directory, refusing anything outside the repository. */
function resolveBundle(resolvedRoot, bundlePath) {
  const bundleInfo = secureChildPath(resolvedRoot, bundlePath ?? "", "Evidence bundle");
  if (!bundleInfo.stats.isDirectory()) throw new Error("Evidence bundle is not a directory.");
  const rootInfo = secureDirectory(resolvedRoot);
  if (!containedBy(bundleInfo.real, rootInfo.real))
    throw new Error("Evidence bundle resolves outside the repository root.");
  return bundleInfo.absolute;
}

function checkFileSet(actualFiles, blockers) {
  const allowed = new Set([...EXPECTED_FILES, "SHA256SUMS"]);
  for (const path of actualFiles) {
    if (allowed.has(path)) continue;
    blockers.push(`Evidence bundle contains an unexpected file: ${path}.`);
    if (/retry/i.test(path)) blockers.push(`Retry artifact is not accepted: ${path}.`);
  }
}

function readJunit(bundle, blockers) {
  let junit = null;
  try {
    junit = junitCounts(secureRead(join(bundle, "junit.xml")).toString("utf8"));
  } catch (error) {
    blockers.push(`Unable to read ${join(bundle, "junit.xml")}: ${describeError(error)}`);
  }
  if (junit?.structuralErrors?.length) blockers.push(...junit.structuralErrors);
  return junit;
}

function readMetadataCounts(counts, blockers) {
  const metadataCounts = {};
  if (!isRecord(counts)) {
    blockers.push("Evidence metadata counts must be an object with every count field.");
    return metadataCounts;
  }
  for (const key of METADATA_COUNT_FIELDS) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) {
      blockers.push(`Evidence metadata count ${key} must be a non-negative integer.`);
    } else metadataCounts[key] = counts[key];
  }
  return metadataCounts;
}

function checkMetadataIdentity(metadata, candidateSha, blockers) {
  if (!metadata || !isRecord(metadata)) blockers.push("metadata.json is not an object.");
  if (metadata?.schemaVersion !== 1) blockers.push("Evidence metadata schemaVersion must be 1.");
  if (metadata?.suite !== "deterministic")
    blockers.push("Evidence metadata is not a deterministic suite.");
  if (metadata?.sourceCommit !== candidateSha)
    blockers.push("Evidence metadata is stale for the candidate commit.");
}

function checkWorkflow(workflow, blockers) {
  if (
    !isRecord(workflow) ||
    workflow.trigger !== "workflow_dispatch" ||
    typeof workflow.url !== "string" ||
    workflow.url.length === 0 ||
    typeof workflow.command !== "string" ||
    workflow.command.length === 0
  )
    blockers.push("Evidence metadata workflow is incomplete.");
}

function checkConfiguration(configuration, blockers) {
  if (
    !isRecord(configuration) ||
    typeof configuration.agentModel !== "string" ||
    configuration.agentModel.length === 0 ||
    !(typeof configuration.eveVersion === "string" || configuration.eveVersion === null) ||
    typeof configuration.database !== "string" ||
    configuration.database.length === 0
  )
    blockers.push("Evidence metadata configuration is incomplete.");
}

function checkTimestamps(timestamps, blockers) {
  if (
    !isRecord(timestamps) ||
    !timestamp(timestamps.startedAt) ||
    !timestamp(timestamps.completedAt) ||
    !timestamp(timestamps.packagedAt)
  )
    blockers.push("Evidence metadata timestamps are incomplete.");
}

/** Who ran it, with what, and when - each incomplete part blocks on its own. */
function checkMetadataProvenance(metadata, blockers) {
  checkWorkflow(metadata?.workflow, blockers);
  checkConfiguration(metadata?.configuration, blockers);
  checkTimestamps(metadata?.timestamps, blockers);
}

function checkCleanRun(metadata, blockers) {
  if (metadata?.clean !== true || metadata?.exitCode !== 0)
    blockers.push("The deterministic run was not clean with exit code 0.");
  const retry = metadata?.retry;
  if (!isRecord(retry) || retry.attempted !== false || retry.rounds !== 0)
    blockers.push("Retry metadata must explicitly say attempted=false and rounds=0.");
}

function checkZeroDefectCounts(metadataCounts, blockers) {
  if (
    metadataCounts.failed !== 0 ||
    metadataCounts.skipped !== 0 ||
    metadataCounts.errored !== 0 ||
    metadataCounts.passed !== metadataCounts.total
  )
    blockers.push("Deterministic counts include a failure, skip, error, or incomplete pass total.");
}

function checkStatuses(statuses, total, blockers) {
  if (!isRecord(statuses) || Object.keys(statuses).length !== 1 || statuses.completed !== total)
    blockers.push("Evidence metadata statuses must contain only completed with the exact total.");
  for (const status of Object.keys(isRecord(statuses) ? statuses : {})) {
    if (status !== COMPLETED) blockers.push(`Evidence contains a non-completed status: ${status}.`);
  }
}

/** The cleanliness contract: no failure, skip, error, retry, or partial state. */
function checkMetadataCleanliness(metadata, metadataCounts, statuses, blockers) {
  checkCleanRun(metadata, blockers);
  checkZeroDefectCounts(metadataCounts, blockers);
  checkStatuses(statuses, metadataCounts.total, blockers);
  for (const field of NON_CLEAN_FLAGS) {
    if (metadata?.[field] === true) blockers.push(`Evidence metadata is marked ${field}.`);
  }
}

function checkSummaryEvals(summary, summaryCounts, blockers) {
  if (!Array.isArray(summary.evals)) {
    blockers.push("Raw summary must contain a complete evals array.");
    return [];
  }
  if (!timestamp(summary.startedAt) || !timestamp(summary.completedAt))
    blockers.push("Raw summary timestamps must include valid startedAt and completedAt.");
  const summaryEvalIds = summary.evals.map((entry) => entry?.id);
  if (summary.evals.length !== summaryCounts.totalEvals)
    blockers.push("Raw summary eval count disagrees with totalEvals.");
  if (!uniqueStringIds(summaryEvalIds))
    blockers.push("Raw summary eval IDs must be unique non-empty strings.");
  for (const entry of summary.evals) {
    if (entry?.result?.status !== COMPLETED)
      blockers.push("Raw summary contains a non-completed eval status.");
  }
  return summaryEvalIds;
}

function readSummary(summary, blockers) {
  const summaryCounts = {};
  if (!isRecord(summary)) {
    blockers.push("raw/initial-summary.json must be an object with every count field.");
    return { summaryCounts, summaryEvalIds: [] };
  }
  for (const key of COUNT_FIELDS) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) {
      blockers.push(`Raw summary count ${key} must be a non-negative integer.`);
    } else summaryCounts[key] = summary[key];
  }
  return { summaryCounts, summaryEvalIds: checkSummaryEvals(summary, summaryCounts, blockers) };
}

function readRows(rows, blockers) {
  const rowCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    total: rows.length,
    statuses: {},
  };
  const rowIds = [];
  for (const row of rows) {
    if (typeof row?.id !== "string" || row.id.length === 0) {
      blockers.push("Evidence JSONL contains a missing eval id.");
    } else if (rowIds.includes(row.id)) {
      blockers.push(`Evidence JSONL duplicates eval id ${row.id}.`);
    } else rowIds.push(row.id);
    if (!ROW_VERDICTS.includes(row?.verdict))
      blockers.push("Evidence JSONL contains an unknown verdict.");
    else rowCounts[row.verdict] += 1;
    if (row?.status !== COMPLETED) {
      blockers.push("Evidence JSONL contains a non-completed status.");
    } else rowCounts.statuses[COMPLETED] = (rowCounts.statuses[COMPLETED] ?? 0) + 1;
  }
  return { rowCounts, rowIds };
}

function checkJunitAgreement(junit, metadataCounts, metadataEvalIds, rowIds, blockers) {
  if (
    !junit ||
    !Number.isInteger(junit.tests) ||
    !Number.isInteger(junit.failures) ||
    !Number.isInteger(junit.skipped) ||
    !Number.isInteger(junit.errors) ||
    junit.tests !== metadataCounts.total ||
    junit.failures !== metadataCounts.failed ||
    junit.skipped !== metadataCounts.skipped ||
    junit.errors !== metadataCounts.errored ||
    junit.tests - junit.failures - junit.skipped - junit.errors !== metadataCounts.passed
  )
    blockers.push("JUnit counts disagree with metadata, JSONL, and raw summary counts.");
  if (!sameIdSet(metadataEvalIds, junit?.ids ?? []) || !sameIdSet(rowIds, junit?.ids ?? []))
    blockers.push("JUnit testcase IDs disagree with metadata, raw summary, and JSONL IDs.");
}

function checkReadme(bundle, candidateSha, blockers) {
  try {
    const readme = secureRead(join(bundle, "README.md")).toString("utf8");
    if (!readme.includes(`Source commit | \`${candidateSha}\``))
      blockers.push("README does not name the exact candidate source commit.");
  } catch (error) {
    blockers.push(`Unable to read README.md: ${describeError(error)}`);
  }
}

function readChecksums(bundle, blockers) {
  const checksumPath = join(bundle, "SHA256SUMS");
  const entries = [];
  try {
    for (const line of secureRead(checksumPath).toString("utf8").split(/\r?\n/).filter(Boolean)) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (!match) {
        blockers.push(`Invalid checksum line: ${line}`);
        continue;
      }
      if (entries.some((entry) => entry.path === match[2])) {
        blockers.push(`Duplicate checksum path: ${match[2]}`);
      } else entries.push({ sha256: match[1], path: match[2] });
    }
  } catch (error) {
    blockers.push(`Unable to read ${checksumPath}: ${describeError(error)}`);
  }
  return entries;
}

function checkChecksums(bundle, checksumEntries, blockers) {
  const expectedSet = new Set(EXPECTED_FILES);
  const actualSet = new Set(checksumEntries.map((entry) => entry.path));
  if (
    checksumEntries.length !== EXPECTED_FILES.length ||
    actualSet.size !== expectedSet.size ||
    [...expectedSet].some((path) => !actualSet.has(path))
  )
    blockers.push("SHA256SUMS does not enumerate the complete evidence bundle.");
  for (const entry of checksumEntries) {
    try {
      const path = secureChildPath(bundle, entry.path, "Checksum path").absolute;
      if (sha256(secureRead(path)) !== entry.sha256)
        blockers.push(`Checksum mismatch for ${entry.path}.`);
    } catch (error) {
      blockers.push(
        `Checksum path is missing, unsafe, or escapes the bundle: ${entry.path} (${describeError(error)})`,
      );
    }
  }
}

function evidenceFormat(path) {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".jsonl")) return "jsonl";
  if (path.endsWith(".xml")) return "junit";
  if (path.endsWith(".md")) return "markdown";
  return "sha256sums";
}

function collectEvidence(bundle, resolvedRoot, candidateSha, blockers) {
  const evidence = [];
  for (const path of EXPECTED_FILES) {
    try {
      const absolute = secureChildPath(bundle, path, "Evidence path").absolute;
      evidence.push({
        path: relative(resolvedRoot, absolute).split(sep).join("/"),
        sourceCommit: candidateSha,
        sha256: sha256(secureRead(absolute)),
        format: evidenceFormat(path),
      });
    } catch (error) {
      blockers.push(`Evidence file is missing or unsafe: ${path} (${describeError(error)})`);
    }
  }
  return evidence;
}

/**
 * Read the four count-bearing files, then cross-check every pair. Metadata is
 * the reference set only because something has to be; every other file is
 * compared against it, so a disagreement anywhere blocks.
 */
function checkBundleContents(bundle, candidateSha, blockers) {
  const metadata = parseJson(join(bundle, "metadata.json"), blockers);
  const rows = readJsonl(join(bundle, "raw/initial-results.jsonl"), blockers);
  const summary = parseJson(join(bundle, "raw/initial-summary.json"), blockers);
  const junit = readJunit(bundle, blockers);

  checkMetadataIdentity(metadata, candidateSha, blockers);
  const metadataCounts = readMetadataCounts(metadata?.counts, blockers);
  if (Number(metadataCounts.total) <= 0)
    blockers.push("Evidence metadata has no positive result total.");
  checkMetadataProvenance(metadata, blockers);
  const metadataEvalIds = metadata?.evalIds;
  if (!uniqueStringIds(metadataEvalIds) || metadataEvalIds.length !== metadataCounts.total)
    blockers.push("Evidence metadata evalIds must be a unique complete eval set.");
  const statuses = metadata?.statuses;
  checkMetadataCleanliness(metadata, metadataCounts, statuses, blockers);

  const { summaryCounts, summaryEvalIds } = readSummary(summary, blockers);
  checkSummaryAgreement(summaryCounts, summaryEvalIds, metadataCounts, metadataEvalIds, blockers);

  const { rowCounts, rowIds } = readRows(rows, blockers);
  checkRowAgreement(
    { rowCounts, rowIds, statuses, metadataCounts, metadataEvalIds, summaryEvalIds },
    blockers,
  );

  checkJunitAgreement(junit, metadataCounts, metadataEvalIds, rowIds, blockers);
}

function checkSummaryAgreement(
  summaryCounts,
  summaryEvalIds,
  metadataCounts,
  metadataEvalIds,
  blockers,
) {
  if (
    summaryCounts.totalEvals !== metadataCounts.total ||
    summaryCounts.passed !== metadataCounts.passed ||
    summaryCounts.failed !== metadataCounts.failed ||
    summaryCounts.skipped !== metadataCounts.skipped ||
    summaryCounts.errored !== metadataCounts.errored
  )
    blockers.push("Raw summary counts disagree with metadata counts.");
  if (!sameIdSet(metadataEvalIds, summaryEvalIds))
    blockers.push("Metadata and raw summary eval ID sets disagree.");
}

function checkRowAgreement(context, blockers) {
  const { rowCounts, rowIds, statuses, metadataCounts, metadataEvalIds, summaryEvalIds } = context;
  if (
    rowCounts.total !== metadataCounts.total ||
    rowCounts.passed !== metadataCounts.passed ||
    rowCounts.failed !== metadataCounts.failed ||
    rowCounts.skipped !== metadataCounts.skipped ||
    rowCounts.errored !== metadataCounts.errored
  )
    blockers.push("JSONL counts disagree with metadata counts.");
  if (!sameJson(rowCounts.statuses, statuses ?? null))
    blockers.push("JSONL statuses disagree with metadata statuses.");
  if (!sameIdSet(metadataEvalIds, rowIds) || !sameIdSet(summaryEvalIds, rowIds))
    blockers.push("Metadata, raw summary, and JSONL eval ID sets disagree.");
}

export function verifyDeterministicEvidenceBundle({
  root = process.cwd(),
  bundlePath,
  candidateSha,
}) {
  const blockers = [];
  const resolvedRoot = resolve(root);
  if (!fullSha(candidateSha))
    blockers.push("The evidence candidate must be a full lowercase commit SHA.");

  let bundle;
  try {
    bundle = resolveBundle(resolvedRoot, bundlePath);
  } catch (error) {
    return blocked([...blockers, describeError(error)]);
  }

  let actualFiles;
  try {
    actualFiles = secureBundleFiles(bundle);
  } catch (error) {
    return blocked([...blockers, describeError(error)]);
  }
  checkFileSet(actualFiles, blockers);

  checkBundleContents(bundle, candidateSha, blockers);
  checkReadme(bundle, candidateSha, blockers);
  checkChecksums(bundle, readChecksums(bundle, blockers), blockers);

  const evidence = collectEvidence(bundle, resolvedRoot, candidateSha, blockers);
  return { status: blockers.length === 0 ? PASS : "blocked", blockers, evidence };
}
