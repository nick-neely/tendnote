#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const QUALIFICATION_SCHEMA_VERSION = 1;
export const QUALIFICATION_KIND = "tendnote.phase-9a.publication-qualification";
export const REPOSITORY = "nick-neely/tendnote";
export const CANONICAL_ORIGIN = "https://tendnote.com";
export const FORMER_ORIGIN = "https://tendnote.stacklet.app";

const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATUSES = new Set([
  "passed",
  "blocked",
  "pending",
  "failed",
  "skipped",
  "recovered",
  "stale",
  "not-run",
]);
const PASS = "passed";

/**
 * The public qualification contract is intentionally a closed list. Adding a
 * new promised surface without adding a criterion here would make it possible
 * for the final report to omit that surface while still looking complete.
 */
export const QUALIFICATION_GATES = Object.freeze([
  {
    id: "repository-readiness",
    name: "Repository readiness",
    criteria: Object.freeze([
      { id: "license", name: "AGPL license is complete and distributable" },
      { id: "third-party-attribution", name: "Third-party licenses and attribution are complete" },
      {
        id: "documentation",
        name: "Security, contribution, support, and self-hosting paths are documented",
      },
      {
        id: "no-maintainer-current-tree-config",
        name: "Current-tree configuration has no maintainer-specific values",
      },
    ]),
  },
  {
    id: "live-governance",
    name: "Live governance",
    criteria: Object.freeze([
      {
        id: "repository-publication-approval",
        name: "Repository publication has explicit owner approval",
      },
      {
        id: "cla-unsigned-external-pr-refusal",
        name: "An unsigned external pull request remains open and unmergeable",
      },
      {
        id: "fork-pr-approval-routing",
        name: "Fork pull-request workflows require approval before privileged execution",
      },
      {
        id: "private-vulnerability-reporting",
        name: "Private Vulnerability Reporting is enabled and unauthenticated access is verified",
      },
    ]),
  },
  {
    id: "self-hosted-admission",
    name: "Self-Hosted Admission",
    criteria: Object.freeze([
      { id: "configured-owner", name: "The configured bootstrap owner is admitted" },
      { id: "pending-unrelated-account", name: "An unrelated account remains pending" },
      {
        id: "concurrent-first-visits",
        name: "Concurrent first visits cannot elect an unauthorized owner",
      },
      {
        id: "invitation-admission",
        name: "A matching live invitation admits the recipient atomically",
      },
      { id: "invalid-configuration", name: "Invalid self-hosted configuration fails closed" },
      {
        id: "unavailable-hosted-flags",
        name: "Unavailable hosted Flags fail closed for unadmitted accounts",
      },
      {
        id: "shared-web-eve-decision",
        name: "Web and Eve enforce the same persisted Access Decision",
      },
    ]),
  },
  {
    id: "owner-data-export",
    name: "Owner Data Export",
    criteria: Object.freeze([
      {
        id: "archive-completeness",
        name: "The archive includes every promised durable record family",
      },
      { id: "owner-isolation", name: "The archive excludes other owners and shared-to records" },
      { id: "authorization", name: "Request and download are owner-authorized" },
      { id: "expiry", name: "The completed artifact expires after the bounded retention window" },
      {
        id: "no-external-notification",
        name: "The journey sends no email or other external notification",
      },
    ]),
  },
  {
    id: "reader-evidence-path",
    name: "Fresh-reader evidence path",
    criteria: Object.freeze([
      { id: "licenses", name: "A fresh reader can find the licenses" },
      { id: "attribution", name: "A fresh reader can find third-party attribution" },
      { id: "navigation", name: "The root README leads through the documentation path" },
      { id: "immutable-links", name: "Evidence links are immutable and resolve" },
      { id: "bounded-claims", name: "The Case Study keeps claims and material limits bounded" },
      { id: "security", name: "Security reporting and privacy boundaries are reachable" },
      { id: "contribution", name: "Contribution and legal paths are reachable" },
      {
        id: "self-hosting",
        name: "Self-hosting limits and operator responsibilities are reachable",
      },
      { id: "support", name: "The community-only support boundary is reachable" },
      {
        id: "no-maintainer-current-tree-config",
        name: "No maintainer-specific current-tree configuration is exposed",
      },
    ]),
  },
  {
    id: "fresh-contributor",
    name: "Fresh-contributor path",
    criteria: Object.freeze([
      { id: "public-links", name: "Every contributor-facing public link resolves" },
      {
        id: "unsigned-external-pr",
        name: "The live unsigned-external-contributor merge refusal is proven",
      },
    ]),
  },
  {
    id: "deterministic-evidence-integrity",
    name: "Deterministic evidence integrity",
    criteria: Object.freeze([
      { id: "clean-summary", name: "The deterministic summary is first-sample clean" },
      { id: "exact-source", name: "The evidence names the exact candidate source commit" },
      { id: "format-agreement", name: "Summary, JUnit, JSON, and JSONL counts agree" },
      { id: "checksums", name: "Every preserved evidence checksum verifies" },
      {
        id: "no-retry-or-skip",
        name: "No retry, recovery, skip, or bootstrap failure is treated as clean",
      },
    ]),
  },
  {
    id: "canonical-origin-redirect",
    name: "Canonical origin and permanent redirect",
    criteria: Object.freeze([
      { id: "canonical-https", name: "The canonical origin serves over HTTPS" },
      {
        id: "former-origin-permanent-redirect",
        name: "The former origin permanently redirects to the canonical origin",
      },
      { id: "redirect-target", name: "The redirect target is the exact canonical origin" },
    ]),
  },
  {
    id: "repository-verification",
    name: "Repository verification",
    criteria: Object.freeze([
      { id: "verify", name: "Full repository verification passes" },
      { id: "database", name: "Database checks pass" },
      { id: "browser", name: "Browser contracts pass" },
      { id: "instant", name: "Instant contracts pass" },
      { id: "coverage", name: "Coverage collection and coverage gate pass" },
      { id: "changed-code-static-analysis", name: "Changed-code static analysis passes" },
      { id: "implicated-lanes", name: "Every lane implicated by the candidate passes" },
    ]),
  },
]);

const GATE_BY_ID = new Map(QUALIFICATION_GATES.map((gate) => [gate.id, gate]));

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fullSha(value) {
  return typeof value === "string" && FULL_SHA.test(value);
}

function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function timestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function blocker(gateId, message, criterionId, code = "blocked") {
  return {
    gateId,
    ...(criterionId ? { criterionId } : {}),
    code,
    message,
  };
}

function criteriaEntries(value) {
  if (Array.isArray(value)) {
    return new Map(
      value.filter((entry) => isRecord(entry) && text(entry.id)).map((entry) => [entry.id, entry]),
    );
  }
  if (isRecord(value)) return new Map(Object.entries(value));
  return new Map();
}

function evidenceEntries(value, candidateSha, gateId, criterionId) {
  if (!Array.isArray(value)) return { entries: [], blockers: [] };
  const entries = [];
  const blockers = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} is not an object.`,
          criterionId,
          "invalid-evidence",
        ),
      );
      continue;
    }
    const path = text(raw.path);
    const uri = text(raw.uri);
    const sourceCommit = text(raw.sourceCommit);
    const sha256 = text(raw.sha256);
    if (!path && !uri) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} has no repository path or URI.`,
          criterionId,
          "invalid-evidence",
        ),
      );
    }
    if (!fullSha(sourceCommit)) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} does not name a full lowercase source commit.`,
          criterionId,
          "invalid-evidence",
        ),
      );
    } else if (sourceCommit !== candidateSha) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} is tied to ${sourceCommit}, not candidate ${candidateSha}.`,
          criterionId,
          "stale-source",
        ),
      );
    }
    if (!digest(sha256)) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} does not contain a SHA-256 digest.`,
          criterionId,
          "invalid-evidence",
        ),
      );
    }
    entries.push({
      ...(path ? { path } : {}),
      ...(uri ? { uri } : {}),
      sourceCommit,
      sha256,
      ...(text(raw.format) ? { format: text(raw.format) } : {}),
      ...(text(raw.description) ? { description: text(raw.description) } : {}),
    });
  }
  return { entries, blockers };
}

function rawGateMap(value) {
  if (Array.isArray(value)) {
    return new Map(
      value.filter((entry) => isRecord(entry) && text(entry.id)).map((entry) => [entry.id, entry]),
    );
  }
  if (isRecord(value)) return new Map(Object.entries(value));
  return new Map();
}

function normalizeGate(gateDefinition, rawValue, candidateSha) {
  const raw = isRecord(rawValue) ? rawValue : {};
  const suppliedStatus = text(raw.status);
  const status = STATUSES.has(suppliedStatus) ? suppliedStatus : rawValue ? "blocked" : "not-run";
  const gateBlockers = [];
  if (suppliedStatus && !STATUSES.has(suppliedStatus)) {
    gateBlockers.push(
      blocker(
        gateDefinition.id,
        `Unknown gate status ${suppliedStatus}.`,
        undefined,
        "invalid-status",
      ),
    );
  }
  if (status !== PASS) {
    gateBlockers.push(
      blocker(
        gateDefinition.id,
        text(raw.reason) || `The ${gateDefinition.name} gate is ${status}.`,
        undefined,
        status,
      ),
    );
  }

  const gateEvidence = evidenceEntries(raw.evidence, candidateSha, gateDefinition.id);
  gateBlockers.push(...gateEvidence.blockers);
  const providedCriteria = criteriaEntries(raw.criteria);
  const criteria = [];

  for (const definition of gateDefinition.criteria) {
    const provided = providedCriteria.get(definition.id);
    const value = isRecord(provided) ? provided : {};
    const suppliedCriterionStatus = text(value.status);
    let criterionStatus = suppliedCriterionStatus || (status === PASS ? "blocked" : status);
    if (!STATUSES.has(criterionStatus)) {
      criterionStatus = "blocked";
    }
    const criterionBlockers = [];
    if (suppliedCriterionStatus && !STATUSES.has(suppliedCriterionStatus)) {
      criterionBlockers.push(
        blocker(
          gateDefinition.id,
          `Unknown criterion status ${suppliedCriterionStatus}.`,
          definition.id,
          "invalid-status",
        ),
      );
    }
    if (!provided && status === PASS) {
      criterionBlockers.push(
        blocker(
          gateDefinition.id,
          "A passing gate must report every listed criterion.",
          definition.id,
          "missing-criterion",
        ),
      );
    }
    if (criterionStatus !== PASS) {
      criterionBlockers.push(
        blocker(
          gateDefinition.id,
          text(value.reason) || `Criterion ${definition.id} is ${criterionStatus}.`,
          definition.id,
          criterionStatus,
        ),
      );
    }
    const criterionEvidence = evidenceEntries(
      value.evidence ?? raw.evidence,
      candidateSha,
      gateDefinition.id,
      definition.id,
    );
    criterionBlockers.push(...criterionEvidence.blockers);
    if (criterionStatus === PASS && criterionEvidence.entries.length === 0) {
      criterionBlockers.push(
        blocker(
          gateDefinition.id,
          "A passing criterion must have exact evidence.",
          definition.id,
          "missing-evidence",
        ),
      );
    }
    criteria.push({
      id: definition.id,
      name: definition.name,
      // Preserve an explicit non-passing state (pending, skipped, recovered,
      // stale, or not-run) so the report remains actionable. A nominal pass
      // with any defect is downgraded to blocked.
      status:
        criterionStatus === PASS && criterionBlockers.length > 0 ? "blocked" : criterionStatus,
      ...(text(value.summary) ? { summary: text(value.summary) } : {}),
      evidence:
        criterionEvidence.entries.length > 0 ? criterionEvidence.entries : gateEvidence.entries,
      blockers: criterionBlockers,
    });
    gateBlockers.push(...criterionBlockers);
  }

  // Preserve an explicit non-passing status in the report so an operator can
  // distinguish pending owner work from a failed or stale proof. A passing
  // status with any defect is downgraded to blocked; no defect is a warning.
  const effectiveStatus = status === PASS && gateBlockers.length > 0 ? "blocked" : status;
  return {
    id: gateDefinition.id,
    name: gateDefinition.name,
    required: true,
    status: effectiveStatus,
    criteria,
    evidence: gateEvidence.entries,
    blockers: dedupeBlockers(gateBlockers),
  };
}

function dedupeBlockers(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundary(input) {
  const source = isRecord(input) ? input : {};
  const publication = isRecord(source.repositoryPublication) ? source.repositoryPublication : {};
  const sends = isRecord(source.externalSends) ? source.externalSends : {};
  return {
    repositoryPublication: {
      status: ["pending-owner-approval", "approved", "not-requested"].includes(
        text(publication.status),
      )
        ? text(publication.status)
        : "pending-owner-approval",
      visibilityMutationPerformed: publication.visibilityMutationPerformed === true,
    },
    externalSends: {
      status: sends.performed === true ? "performed" : "none",
      performed: sends.performed === true,
    },
  };
}

/**
 * Compose the one report consumed by the final publication decision.
 *
 * The function is deliberately data-in/data-out. Product proofs and live
 * operator observations are run by their owning gates; this layer refuses to
 * infer a pass from an absent, skipped, recovered, stale, or warning result.
 */
export function composeQualificationReport(input = {}) {
  const source = isRecord(input) ? input : {};
  const candidate = isRecord(source.candidate) ? source.candidate : {};
  const candidateSha = text(source.candidateSha) || text(candidate.commit);
  const inputBlockers = [];
  if (!fullSha(candidateSha)) {
    inputBlockers.push({
      code: "invalid-candidate",
      message: "The candidate must be a full lowercase commit SHA.",
    });
  }
  const repository = text(source.repository) || text(candidate.repository) || REPOSITORY;
  if (repository !== REPOSITORY) {
    inputBlockers.push({
      code: "unexpected-repository",
      message: `Expected ${REPOSITORY}, received ${repository}.`,
    });
  }
  const generatedAt = text(source.generatedAt) || new Date().toISOString();
  if (!timestamp(generatedAt)) {
    inputBlockers.push({
      code: "invalid-timestamp",
      message: "generatedAt must be an ISO UTC timestamp.",
    });
  }
  const rawGates = rawGateMap(source.gates);
  const gates = QUALIFICATION_GATES.map((definition) =>
    normalizeGate(definition, rawGates.get(definition.id), candidateSha),
  );
  const unknownGates = [...rawGates.keys()].filter((id) => !GATE_BY_ID.has(id));
  for (const id of unknownGates) {
    inputBlockers.push({ code: "unknown-gate", message: `Input contains unknown gate ${id}.` });
  }

  const reportBoundary = boundary(source.boundary);
  if (reportBoundary.repositoryPublication.visibilityMutationPerformed) {
    inputBlockers.push({
      code: "visibility-mutated",
      message:
        "Qualification evidence cannot claim a clean run after an unapproved visibility mutation.",
    });
  }
  if (reportBoundary.externalSends.performed) {
    inputBlockers.push({
      code: "external-send-performed",
      message: "Qualification evidence cannot authorize or imply an external send.",
    });
  }

  const gateBlockers = gates.flatMap((gate) => gate.blockers);
  const blockers = [
    ...inputBlockers.map((entry) => ({ gateId: "report-contract", ...entry })),
    ...gateBlockers,
  ];
  const status = blockers.length === 0 ? "qualified" : "blocked";
  const report = {
    schemaVersion: QUALIFICATION_SCHEMA_VERSION,
    kind: QUALIFICATION_KIND,
    repository,
    generatedAt,
    candidate: {
      commit: candidateSha,
      visibility: ["private", "public", "unknown"].includes(text(candidate.visibility))
        ? text(candidate.visibility)
        : "private",
      immutable: true,
    },
    result: {
      status,
      clean: status === "qualified",
      blockers: dedupeBlockers(blockers),
    },
    gates,
    boundary: reportBoundary,
  };
  const validation = validateQualificationReport(report);
  if (!validation.valid) {
    report.result.status = "blocked";
    report.result.clean = false;
    report.result.blockers = dedupeBlockers([
      ...report.result.blockers,
      ...validation.errors.map((message) => ({
        gateId: "report-contract",
        code: "invalid-report",
        message,
      })),
    ]);
  }
  return report;
}

/** Validate a serialized report without trusting its `result.status` claim. */
export function validateQualificationReport(report) {
  const errors = [];
  if (!isRecord(report)) return { valid: false, errors: ["Report must be an object."] };
  if (report.schemaVersion !== QUALIFICATION_SCHEMA_VERSION)
    errors.push("Unsupported schemaVersion.");
  if (report.kind !== QUALIFICATION_KIND) errors.push("Unexpected report kind.");
  if (report.repository !== REPOSITORY) errors.push(`repository must be ${REPOSITORY}.`);
  if (!timestamp(report.generatedAt)) errors.push("generatedAt must be an ISO UTC timestamp.");
  if (!isRecord(report.candidate) || !fullSha(report.candidate?.commit))
    errors.push("candidate.commit must be a full lowercase SHA.");
  if (!isRecord(report.result) || !["blocked", "qualified"].includes(report.result?.status))
    errors.push("result.status must be blocked or qualified.");
  if (!isRecord(report.boundary)) errors.push("boundary is required.");
  if (report.boundary?.externalSends?.performed !== false)
    errors.push("external sends must be explicitly absent.");
  if (report.boundary?.repositoryPublication?.visibilityMutationPerformed !== false)
    errors.push("visibility mutation must be explicitly absent.");

  const expectedGates = QUALIFICATION_GATES.map((gate) => gate.id);
  const actualGates = Array.isArray(report.gates) ? report.gates : [];
  if (actualGates.length !== expectedGates.length)
    errors.push("Report must contain every qualification gate exactly once.");
  const seenGates = new Set();
  for (const gate of actualGates) {
    if (!isRecord(gate) || !text(gate.id)) {
      errors.push("Every gate must have an id.");
      continue;
    }
    if (seenGates.has(gate.id)) errors.push(`Duplicate gate ${gate.id}.`);
    seenGates.add(gate.id);
    const definition = GATE_BY_ID.get(gate.id);
    if (!definition) {
      errors.push(`Unknown gate ${gate.id}.`);
      continue;
    }
    if (gate.required !== true) errors.push(`Gate ${gate.id} must be required.`);
    if (!STATUSES.has(gate.status)) errors.push(`Gate ${gate.id} has an invalid status.`);
    const expectedCriteria = definition.criteria.map((criterion) => criterion.id);
    const actualCriteria = Array.isArray(gate.criteria) ? gate.criteria : [];
    if (actualCriteria.length !== expectedCriteria.length)
      errors.push(`Gate ${gate.id} must report every criterion.`);
    const seenCriteria = new Set();
    for (const criterion of actualCriteria) {
      if (!isRecord(criterion) || !text(criterion.id)) {
        errors.push(`Gate ${gate.id} contains a criterion without an id.`);
        continue;
      }
      if (seenCriteria.has(criterion.id))
        errors.push(`Gate ${gate.id} duplicates criterion ${criterion.id}.`);
      seenCriteria.add(criterion.id);
      if (!expectedCriteria.includes(criterion.id))
        errors.push(`Gate ${gate.id} contains unknown criterion ${criterion.id}.`);
      if (!STATUSES.has(criterion.status))
        errors.push(`Criterion ${gate.id}/${criterion.id} has an invalid status.`);
      if (
        criterion.status === PASS &&
        (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0)
      ) {
        errors.push(`Passing criterion ${gate.id}/${criterion.id} has no evidence.`);
      }
      for (const evidence of Array.isArray(criterion.evidence) ? criterion.evidence : []) {
        if (!fullSha(evidence?.sourceCommit))
          errors.push(`Evidence for ${gate.id}/${criterion.id} has no full source commit.`);
        if (
          fullSha(report.candidate?.commit) &&
          evidence?.sourceCommit !== report.candidate.commit
        ) {
          errors.push(`Evidence for ${gate.id}/${criterion.id} is stale for the candidate.`);
        }
        if (!digest(evidence?.sha256))
          errors.push(`Evidence for ${gate.id}/${criterion.id} has no SHA-256 digest.`);
        if (!text(evidence?.path) && !text(evidence?.uri))
          errors.push(`Evidence for ${gate.id}/${criterion.id} has no path or URI.`);
      }
    }
    if (gate.status === PASS && gate.blockers?.length)
      errors.push(`Passing gate ${gate.id} contains blockers.`);
    if (gate.status !== PASS && (!Array.isArray(gate.blockers) || gate.blockers.length === 0))
      errors.push(`Blocking gate ${gate.id} has no blocker reason.`);
  }
  if (seenGates.size !== expectedGates.length || expectedGates.some((id) => !seenGates.has(id)))
    errors.push("Report is missing one or more qualification gates.");

  const allPassed =
    actualGates.length === expectedGates.length &&
    actualGates.every(
      (gate) =>
        gate?.status === PASS && gate.criteria?.every((criterion) => criterion?.status === PASS),
    );
  const blockers = Array.isArray(report.result?.blockers) ? report.result.blockers : [];
  if (report.result?.status === "qualified" && (!allPassed || blockers.length > 0))
    errors.push("A qualified report must have every criterion passed and no blockers.");
  if (report.result?.status === "blocked" && blockers.length === 0)
    errors.push("A blocked report must identify at least one blocker.");
  return { valid: errors.length === 0, errors };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(path, blockers) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    blockers.push(
      `Unable to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function junitCounts(xml) {
  const suite = xml.match(/<testsuite\b[^>]*>/)?.[0];
  if (!suite) return null;
  const number = (name) => Number(suite.match(new RegExp(`${name}="(\\d+)"`))?.[1]);
  return { tests: number("tests"), failures: number("failures"), skipped: number("skipped") };
}

function readJsonl(path, blockers) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    blockers.push(
      `Unable to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Validate the exact deterministic bundle produced by the Eve evidence
 * packager. This never upgrades a non-clean run; it returns blocking reasons
 * for skipped, waiting, retried, stale, mismatched, or partially written data.
 */
export function verifyDeterministicEvidenceBundle({
  root = process.cwd(),
  bundlePath,
  candidateSha,
}) {
  const blockers = [];
  const resolvedRoot = resolve(root);
  const bundle = resolve(resolvedRoot, bundlePath ?? "");
  const expectedFiles = [
    "README.md",
    "junit.xml",
    "metadata.json",
    "raw/results.jsonl",
    "raw/summary.json",
  ];
  if (!fullSha(candidateSha))
    blockers.push("The evidence candidate must be a full lowercase commit SHA.");
  if (bundle === resolvedRoot || !bundle.startsWith(`${resolvedRoot}${sep}`)) {
    return {
      status: "blocked",
      blockers: [...blockers, "Evidence bundle must be a child of the repository root."],
      evidence: [],
    };
  }
  if (!existsSync(bundle) || !statSync(bundle).isDirectory()) {
    return {
      status: "blocked",
      blockers: [...blockers, `Evidence bundle is missing: ${bundle}.`],
      evidence: [],
    };
  }
  const metadata = parseJson(join(bundle, "metadata.json"), blockers);
  const rows = readJsonl(join(bundle, "raw/results.jsonl"), blockers);
  const summary = parseJson(join(bundle, "raw/summary.json"), blockers);
  let junit = null;
  try {
    junit = junitCounts(readFileSync(join(bundle, "junit.xml"), "utf8"));
  } catch (error) {
    blockers.push(
      `Unable to read ${join(bundle, "junit.xml")}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!metadata || !isRecord(metadata)) blockers.push("metadata.json is not an object.");
  if (metadata?.suite !== "deterministic")
    blockers.push("Evidence metadata is not a deterministic suite.");
  if (metadata?.sourceCommit !== candidateSha)
    blockers.push("Evidence metadata is stale for the candidate commit.");
  const counts = metadata?.counts;
  if (!isRecord(counts) || Number(counts.total) <= 0)
    blockers.push("Evidence metadata has no positive result total.");
  if (metadata?.clean !== true || metadata?.exitCode !== 0)
    blockers.push("The deterministic run was not clean with exit code 0.");
  if (metadata?.retry?.attempted === true || Number(metadata?.retry?.rounds ?? 0) !== 0)
    blockers.push("A retry or recovery was recorded; it cannot qualify as clean.");
  if (
    Number(counts?.failed ?? 0) !== 0 ||
    Number(counts?.skipped ?? 0) !== 0 ||
    Number(counts?.errored ?? 0) !== 0 ||
    Number(counts?.passed ?? 0) !== Number(counts?.total ?? 0)
  )
    blockers.push("Deterministic counts include a failure, skip, error, or incomplete pass total.");
  if (metadata?.statuses?.waiting)
    blockers.push("Evidence contains waiting results rather than completed results.");
  const rowCounts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    total: rows.length,
    statuses: {},
  };
  for (const row of rows) {
    if (!["passed", "failed", "skipped", "errored"].includes(row?.verdict))
      blockers.push("Evidence JSONL contains an unknown verdict.");
    else rowCounts[row.verdict] += 1;
    if (typeof row?.status !== "string" || row.status.length === 0)
      blockers.push("Evidence JSONL contains a missing status.");
    else rowCounts.statuses[row.status] = (rowCounts.statuses[row.status] ?? 0) + 1;
  }
  if (
    rowCounts.total !== Number(counts?.total ?? -1) ||
    rowCounts.passed !== Number(counts?.passed ?? -1) ||
    rowCounts.failed !== Number(counts?.failed ?? -1) ||
    rowCounts.skipped !== Number(counts?.skipped ?? -1) ||
    rowCounts.errored !== Number(counts?.errored ?? -1)
  )
    blockers.push("JSONL counts disagree with metadata counts.");
  if (JSON.stringify(rowCounts.statuses) !== JSON.stringify(metadata?.statuses ?? null))
    blockers.push("JSONL statuses disagree with metadata statuses.");
  if (
    !junit ||
    junit.tests !== Number(counts?.total ?? -1) ||
    junit.failures !== 0 ||
    junit.skipped !== 0
  )
    blockers.push("JUnit counts disagree with a clean deterministic run.");
  if (isRecord(summary)) {
    for (const key of ["totalEvals", "passed", "failed", "skipped", "errored"]) {
      if (
        key in summary &&
        Number(summary[key]) !==
          (key === "totalEvals" ? Number(counts?.total) : Number(counts?.[key]))
      )
        blockers.push(`Raw summary ${key} disagrees with metadata.`);
    }
  }

  const checksumPath = join(bundle, "SHA256SUMS");
  const checksumEntries = [];
  try {
    for (const line of readFileSync(checksumPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (!match) {
        blockers.push(`Invalid checksum line: ${line}`);
        continue;
      }
      checksumEntries.push({ sha256: match[1], path: match[2] });
    }
  } catch (error) {
    blockers.push(
      `Unable to read ${checksumPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(checksumEntries.map((entry) => entry.path));
  if (
    checksumEntries.length !== expectedFiles.length ||
    actualSet.size !== expectedSet.size ||
    [...expectedSet].some((path) => !actualSet.has(path))
  )
    blockers.push("SHA256SUMS does not enumerate the complete evidence bundle.");
  for (const entry of checksumEntries) {
    const path = resolve(bundle, entry.path);
    if (!path.startsWith(`${bundle}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
      blockers.push(`Checksum path is missing or escapes the bundle: ${entry.path}`);
      continue;
    }
    if (sha256(readFileSync(path)) !== entry.sha256)
      blockers.push(`Checksum mismatch for ${entry.path}.`);
  }

  const evidence = expectedFiles
    .filter((path) => existsSync(join(bundle, path)))
    .map((path) => ({
      path: relative(resolvedRoot, join(bundle, path)).split(sep).join("/"),
      sourceCommit: candidateSha,
      sha256: sha256(readFileSync(join(bundle, path))),
      format: path.endsWith(".json")
        ? "json"
        : path.endsWith(".jsonl")
          ? "jsonl"
          : path.endsWith(".xml")
            ? "junit"
            : path.endsWith(".md")
              ? "markdown"
              : "sha256sums",
    }));
  return { status: blockers.length === 0 ? PASS : "blocked", blockers, evidence };
}

/** Verify tracked evidence bytes against the report's candidate and digests. */
export function verifyEvidenceFiles({ root = process.cwd(), candidateSha, evidence }) {
  const blockers = [];
  const resolvedRoot = resolve(root);
  for (const entry of Array.isArray(evidence) ? evidence : []) {
    if (!fullSha(entry?.sourceCommit) || entry.sourceCommit !== candidateSha) {
      blockers.push(
        `Evidence ${entry?.path ?? entry?.uri ?? "unknown"} is not tied to the candidate.`,
      );
      continue;
    }
    if (!text(entry.path)) continue;
    const path = resolve(resolvedRoot, entry.path);
    if (
      !path.startsWith(`${resolvedRoot}${sep}`) ||
      !existsSync(path) ||
      !statSync(path).isFile()
    ) {
      blockers.push(`Evidence file is missing or escapes the repository: ${entry.path}`);
      continue;
    }
    if (sha256(readFileSync(path)) !== entry.sha256)
      blockers.push(`Evidence digest mismatch: ${entry.path}`);
    try {
      execFileSync("git", ["cat-file", "-e", `${candidateSha}:${entry.path}`], {
        cwd: resolvedRoot,
        stdio: "ignore",
      });
    } catch {
      blockers.push(
        `Evidence file is not present in candidate commit ${candidateSha}: ${entry.path}`,
      );
    }
  }
  return { status: blockers.length === 0 ? PASS : "blocked", blockers };
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? response?.headers?.[name] ?? null;
}

function origin(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash)
      throw new Error(`${label} must be an origin, not a path.`);
    return parsed;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

/** Read-only HTTPS check for the completed domain prerequisite. */
export async function verifyCanonicalOrigin({
  canonicalOrigin = CANONICAL_ORIGIN,
  formerOrigin = FORMER_ORIGIN,
  fetchImpl = globalThis.fetch,
} = {}) {
  const blockers = [];
  let canonical;
  let former;
  try {
    canonical = origin(canonicalOrigin, "canonical origin");
    former = origin(formerOrigin, "former origin");
  } catch (error) {
    return {
      status: "blocked",
      blockers: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (typeof fetchImpl !== "function")
    return {
      status: "blocked",
      blockers: ["No fetch implementation is available for the read-only origin check."],
    };
  let canonicalResponse;
  let formerResponse;
  try {
    canonicalResponse = await fetchImpl(canonical.toString(), {
      method: "GET",
      redirect: "manual",
    });
    formerResponse = await fetchImpl(former.toString(), { method: "GET", redirect: "manual" });
  } catch (error) {
    return {
      status: "blocked",
      blockers: [
        `Origin verification failed before both responses were observed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!canonicalResponse || canonicalResponse.status < 200 || canonicalResponse.status >= 300)
    blockers.push(
      `Canonical origin returned ${canonicalResponse?.status ?? "no status"}, not a successful HTTPS response.`,
    );
  const location = responseHeader(formerResponse, "location");
  if (![301, 308].includes(formerResponse?.status))
    blockers.push(
      `Former origin returned ${formerResponse?.status ?? "no status"}; expected a permanent 301 or 308 redirect.`,
    );
  if (!location) blockers.push("Former origin did not provide a redirect Location.");
  else {
    try {
      const target = new URL(location, former);
      if (
        target.protocol !== "https:" ||
        target.origin !== canonical.origin ||
        target.pathname !== "/" ||
        target.search ||
        target.hash
      )
        blockers.push(
          `Former origin redirects to ${target.toString()}, not the exact canonical origin.`,
        );
    } catch {
      blockers.push("Former origin Location is not a valid URL.");
    }
  }
  return {
    status: blockers.length === 0 ? PASS : "blocked",
    blockers,
    checks: {
      canonical: { url: canonical.toString(), status: canonicalResponse?.status ?? null },
      former: { url: former.toString(), status: formerResponse?.status ?? null, location },
    },
  };
}

function readInput(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  return "Usage: publication-qualification.mjs [--candidate-sha <full-sha>] [--input <gate-results.json>] [--output <report.json>]";
}

export function main() {
  const candidateSha =
    argument("--candidate-sha") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!fullSha(candidateSha))
    throw new Error(`${usage()}\nCandidate must be a full lowercase commit SHA.`);
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actual !== candidateSha)
    throw new Error(`Checked out ${actual}, not requested candidate ${candidateSha}.`);
  const inputPath = argument("--input");
  const input = inputPath ? readInput(inputPath) : { candidateSha, gates: {} };
  if (text(input.candidateSha) && input.candidateSha !== candidateSha)
    throw new Error(`Input names ${input.candidateSha}, not candidate ${candidateSha}.`);
  const report = composeQualificationReport({ ...input, candidateSha });
  const outputPath = argument("--output");
  if (outputPath) writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.result.status === "qualified" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
