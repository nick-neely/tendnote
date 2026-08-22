#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const QUALIFICATION_SCHEMA_VERSION = 1;
export const QUALIFICATION_KIND = "tendnote.phase-9a.publication-qualification";
export const REPOSITORY = "nick-neely/tendnote";
export const CANONICAL_ORIGIN = "https://tendnote.com";
const FORMER_HOST = ["tendnote", "stacklet", "app"].join(".");
export const FORMER_ORIGIN = `https://${FORMER_HOST}`;

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
const COMPLETED = "completed";
const QUALIFICATION_OUTPUT_ROOT = "evidence/qualification";
const COUNT_FIELDS = Object.freeze(["totalEvals", "passed", "failed", "skipped", "errored"]);
const METADATA_COUNT_FIELDS = Object.freeze(["total", "passed", "failed", "skipped", "errored"]);

/** Machine identities for owner-controlled qualification seams. */
export const QUALIFICATION_BINDINGS = Object.freeze({
  "repository-publication-approval": Object.freeze({
    source: "github-issue",
    issue: 489,
    state: "approved",
  }),
  "cla-unsigned-external-pr-refusal": Object.freeze({
    source: "github-issue",
    issue: 516,
    state: "verified",
  }),
  "fork-pr-approval-routing": Object.freeze({
    source: "github-issue",
    issue: 494,
    state: "verified",
  }),
  "private-vulnerability-reporting": Object.freeze({
    source: "github-setting",
    setting: "private-vulnerability-reporting",
    state: "enabled-and-unauthenticated-verified",
  }),
});

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

function bindingFor(criterionId) {
  return QUALIFICATION_BINDINGS[criterionId];
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueStringIds(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(value).size === value.length
  );
}

function sameIdSet(left, right) {
  return (
    uniqueStringIds(left) &&
    uniqueStringIds(right) &&
    left.length === right.length &&
    left.every((id) => right.includes(id))
  );
}

function criteriaEntries(value, gateId, definitions, blockers) {
  const entries = new Map();
  const expected = new Set(definitions.map((definition) => definition.id));
  if (value === undefined) return entries;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      if (!isRecord(entry) || !text(entry.id)) {
        blockers.push(
          blocker(
            gateId,
            `Criterion entry ${index + 1} has no id.`,
            undefined,
            "invalid-criterion",
          ),
        );
        continue;
      }
      if (entries.has(entry.id)) {
        blockers.push(
          blocker(gateId, `Duplicate criterion ${entry.id}.`, entry.id, "duplicate-criterion"),
        );
        continue;
      }
      if (!expected.has(entry.id)) {
        blockers.push(
          blocker(gateId, `Unknown criterion ${entry.id}.`, entry.id, "unknown-criterion"),
        );
      }
      entries.set(entry.id, entry);
    }
    return entries;
  }
  if (!isRecord(value)) {
    blockers.push(
      blocker(gateId, "Criteria must be an object or array.", undefined, "invalid-criteria"),
    );
    return entries;
  }
  for (const [id, entry] of Object.entries(value)) {
    if (entries.has(id)) {
      blockers.push(blocker(gateId, `Duplicate criterion ${id}.`, id, "duplicate-criterion"));
      continue;
    }
    if (!expected.has(id)) {
      blockers.push(blocker(gateId, `Unknown criterion ${id}.`, id, "unknown-criterion"));
    }
    entries.set(id, entry);
  }
  return entries;
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
    if (path && (isAbsolute(path) || path.split(/[\\/]/).includes(".."))) {
      blockers.push(
        blocker(
          gateId,
          `Evidence entry ${index + 1} has an absolute or escaping repository path.`,
          criterionId,
          "invalid-evidence",
        ),
      );
    }
    if (uri) {
      try {
        new URL(uri);
      } catch {
        blockers.push(
          blocker(
            gateId,
            `Evidence entry ${index + 1} does not contain a valid URI.`,
            criterionId,
            "invalid-evidence",
          ),
        );
      }
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

function rawGateMap(value, blockers) {
  const entries = new Map();
  if (value === undefined) return entries;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      if (!isRecord(entry) || !text(entry.id)) {
        blockers.push({
          code: "invalid-gate",
          message: `Gate entry ${index + 1} has no id.`,
        });
        continue;
      }
      if (entries.has(entry.id)) {
        blockers.push({ code: "duplicate-gate", message: `Duplicate gate ${entry.id}.` });
        continue;
      }
      if (!GATE_BY_ID.has(entry.id)) {
        blockers.push({
          code: "unknown-gate",
          message: `Input contains unknown gate ${entry.id}.`,
        });
      }
      entries.set(entry.id, entry);
    }
    return entries;
  }
  if (!isRecord(value)) {
    blockers.push({ code: "invalid-gates", message: "Gates must be an object or array." });
    return entries;
  }
  for (const [id, entry] of Object.entries(value)) {
    if (entries.has(id)) {
      blockers.push({ code: "duplicate-gate", message: `Duplicate gate ${id}.` });
      continue;
    }
    if (!GATE_BY_ID.has(id)) {
      blockers.push({ code: "unknown-gate", message: `Input contains unknown gate ${id}.` });
    }
    entries.set(id, entry);
  }
  return entries;
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
  const providedCriteria = criteriaEntries(
    raw.criteria,
    gateDefinition.id,
    gateDefinition.criteria,
    gateBlockers,
  );
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
    const expectedBinding = bindingFor(definition.id);
    if (expectedBinding) {
      if (!isRecord(value.binding) || !sameJson(value.binding, expectedBinding)) {
        criterionBlockers.push(
          blocker(
            gateDefinition.id,
            `Criterion ${definition.id} must include its exact machine binding.`,
            definition.id,
            "missing-or-invalid-binding",
          ),
        );
      }
    } else if (value.binding !== undefined) {
      criterionBlockers.push(
        blocker(
          gateDefinition.id,
          `Criterion ${definition.id} contains an unexpected machine binding.`,
          definition.id,
          "unexpected-binding",
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
      value.evidence,
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
      ...(expectedBinding ? { binding: expectedBinding } : {}),
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
  const blockers = [];
  const hasPublication = Object.hasOwn(source, "repositoryPublication");
  const hasSends = Object.hasOwn(source, "externalSends");
  const publication = isRecord(source.repositoryPublication) ? source.repositoryPublication : {};
  const sends = isRecord(source.externalSends) ? source.externalSends : {};

  for (const key of Object.keys(source)) {
    if (!["repositoryPublication", "externalSends"].includes(key))
      blockers.push({
        code: "unknown-boundary-property",
        message: `Unknown boundary property ${key}.`,
      });
  }
  for (const key of Object.keys(publication)) {
    if (!["status", "visibilityMutationPerformed"].includes(key))
      blockers.push({
        code: "unknown-boundary-property",
        message: `Unknown repositoryPublication property ${key}.`,
      });
  }
  for (const key of Object.keys(sends)) {
    if (!["status", "performed"].includes(key))
      blockers.push({
        code: "unknown-boundary-property",
        message: `Unknown externalSends property ${key}.`,
      });
  }

  if (!hasPublication || !isRecord(source.repositoryPublication)) {
    blockers.push({
      code: "boundary-missing",
      message: "repositoryPublication boundary must be explicitly supplied.",
    });
  }
  if (!hasSends || !isRecord(source.externalSends)) {
    blockers.push({
      code: "boundary-missing",
      message: "externalSends boundary must be explicitly supplied.",
    });
  }

  const publicationStatus = text(publication.status);
  const validPublicationStatus = ["pending-owner-approval", "approved", "not-requested"].includes(
    publicationStatus,
  );
  if (!Object.hasOwn(publication, "status")) {
    blockers.push({
      code: "boundary-defaulted",
      message: "repositoryPublication.status must be explicit.",
    });
  } else if (!validPublicationStatus) {
    blockers.push({
      code: "boundary-status",
      message: `Unknown repositoryPublication.status ${publicationStatus || "<empty>"}.`,
    });
  } else if (publicationStatus !== "approved") {
    blockers.push({
      code: publicationStatus,
      message: `Repository publication boundary is ${publicationStatus}; owner approval is required.`,
    });
  }

  if (!Object.hasOwn(publication, "visibilityMutationPerformed")) {
    blockers.push({
      code: "boundary-defaulted",
      message: "repositoryPublication.visibilityMutationPerformed must be explicit false.",
    });
  } else if (typeof publication.visibilityMutationPerformed !== "boolean") {
    blockers.push({
      code: "malformed-boundary-boolean",
      message: "repositoryPublication.visibilityMutationPerformed must be a boolean.",
    });
  } else if (publication.visibilityMutationPerformed !== false) {
    blockers.push({
      code: "visibility-mutated",
      message: "Qualification evidence cannot claim a clean run after a visibility mutation.",
    });
  }

  const sendsStatus = text(sends.status);
  if (!Object.hasOwn(sends, "status")) {
    blockers.push({
      code: "boundary-defaulted",
      message: "externalSends.status must be explicit none.",
    });
  } else if (sendsStatus !== "none") {
    blockers.push({
      code: "external-send-status",
      message: `externalSends.status must be none, received ${sendsStatus || "<empty>"}.`,
    });
  }
  if (!Object.hasOwn(sends, "performed")) {
    blockers.push({
      code: "boundary-defaulted",
      message: "externalSends.performed must be explicit false.",
    });
  } else if (typeof sends.performed !== "boolean") {
    blockers.push({
      code: "malformed-boundary-boolean",
      message: "externalSends.performed must be a boolean.",
    });
  } else if (sends.performed !== false) {
    blockers.push({
      code: "external-send-performed",
      message: "Qualification evidence cannot authorize or imply an external send.",
    });
  }

  return {
    value: {
      repositoryPublication: {
        status: validPublicationStatus ? publicationStatus : "pending-owner-approval",
        visibilityMutationPerformed: false,
      },
      externalSends: { status: "none", performed: false },
    },
    blockers,
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
  const topLevelCandidateSha = text(source.candidateSha);
  const nestedCandidateSha = text(candidate.commit);
  const candidateSha = topLevelCandidateSha || nestedCandidateSha;
  const inputBlockers = [];
  if (topLevelCandidateSha && nestedCandidateSha && topLevelCandidateSha !== nestedCandidateSha) {
    inputBlockers.push({
      code: "conflicting-candidate",
      message: `Top-level candidateSha ${topLevelCandidateSha} disagrees with candidate.commit ${nestedCandidateSha}.`,
    });
  }
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
  const rawGates = rawGateMap(source.gates, inputBlockers);
  const gates = QUALIFICATION_GATES.map((definition) =>
    normalizeGate(definition, rawGates.get(definition.id), candidateSha),
  );

  const reportBoundary = boundary(source.boundary);
  inputBlockers.push(...reportBoundary.blockers);

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
    boundary: reportBoundary.value,
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

  const exactKeys = (value, allowed, label) => {
    if (!isRecord(value)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) errors.push(`${label} contains unknown property ${key}.`);
    }
  };
  exactKeys(
    report,
    [
      "schemaVersion",
      "kind",
      "repository",
      "generatedAt",
      "candidate",
      "result",
      "gates",
      "boundary",
    ],
    "Report",
  );
  if (report.schemaVersion !== QUALIFICATION_SCHEMA_VERSION)
    errors.push("Unsupported schemaVersion.");
  if (report.kind !== QUALIFICATION_KIND) errors.push("Unexpected report kind.");
  if (report.repository !== REPOSITORY) errors.push(`repository must be ${REPOSITORY}.`);
  if (!timestamp(report.generatedAt)) errors.push("generatedAt must be an ISO UTC timestamp.");

  exactKeys(report.candidate, ["commit", "visibility", "immutable"], "candidate");
  if (!isRecord(report.candidate) || !fullSha(report.candidate?.commit))
    errors.push("candidate.commit must be a full lowercase SHA.");
  if (
    !isRecord(report.candidate) ||
    !["private", "public", "unknown"].includes(report.candidate.visibility)
  )
    errors.push("candidate.visibility must be private, public, or unknown.");
  if (report.candidate?.immutable !== true) errors.push("candidate.immutable must be true.");

  exactKeys(report.result, ["status", "clean", "blockers"], "result");
  if (!isRecord(report.result) || !["blocked", "qualified"].includes(report.result?.status))
    errors.push("result.status must be blocked or qualified.");
  if (typeof report.result?.clean !== "boolean") errors.push("result.clean must be boolean.");
  if (
    typeof report.result?.clean === "boolean" &&
    report.result.clean !== (report.result.status === "qualified")
  )
    errors.push("result.clean must agree with result.status.");

  const validateBlockers = (value, label) => {
    if (!Array.isArray(value)) {
      errors.push(`${label} must be an array.`);
      return;
    }
    for (const [index, entry] of value.entries()) {
      exactKeys(entry, ["gateId", "criterionId", "code", "message"], `${label}[${index}]`);
      if (!isRecord(entry) || !text(entry.gateId) || !text(entry.code) || !text(entry.message))
        errors.push(`${label}[${index}] must have gateId, code, and message.`);
      if (entry?.criterionId !== undefined && !text(entry.criterionId))
        errors.push(`${label}[${index}].criterionId must be non-empty when present.`);
    }
  };
  validateBlockers(report.result?.blockers, "result.blockers");

  const validateEvidence = (value, label) => {
    if (!Array.isArray(value)) {
      errors.push(`${label} must be an array.`);
      return;
    }
    for (const [index, entry] of value.entries()) {
      const itemLabel = `${label}[${index}]`;
      exactKeys(
        entry,
        ["path", "uri", "sourceCommit", "sha256", "format", "description"],
        itemLabel,
      );
      if (!isRecord(entry) || (!text(entry.path) && !text(entry.uri)))
        errors.push(`${itemLabel} needs a path or URI.`);
      if (entry?.path !== undefined && typeof entry.path !== "string")
        errors.push(`${itemLabel}.path must be a string.`);
      if (
        typeof entry?.path === "string" &&
        entry.path &&
        (isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes(".."))
      )
        errors.push(`${itemLabel}.path must remain within its evidence root.`);
      if (entry?.uri !== undefined && typeof entry.uri !== "string")
        errors.push(`${itemLabel}.uri must be a string.`);
      if (typeof entry?.uri === "string" && entry.uri) {
        try {
          new URL(entry.uri);
        } catch {
          errors.push(`${itemLabel}.uri must be a valid URI.`);
        }
      }
      if (!fullSha(entry?.sourceCommit) || entry.sourceCommit !== report.candidate?.commit)
        errors.push(`${itemLabel}.sourceCommit must equal candidate.commit.`);
      if (!digest(entry?.sha256)) errors.push(`${itemLabel}.sha256 must be a SHA-256 digest.`);
      if (entry?.format !== undefined && !text(entry.format))
        errors.push(`${itemLabel}.format must be non-empty.`);
      if (entry?.description !== undefined && !text(entry.description))
        errors.push(`${itemLabel}.description must be non-empty.`);
    }
  };

  exactKeys(report.boundary, ["repositoryPublication", "externalSends"], "boundary");
  exactKeys(
    report.boundary?.repositoryPublication,
    ["status", "visibilityMutationPerformed"],
    "boundary.repositoryPublication",
  );
  exactKeys(report.boundary?.externalSends, ["status", "performed"], "boundary.externalSends");
  if (!isRecord(report.boundary)) errors.push("boundary is required.");
  if (!isRecord(report.boundary?.repositoryPublication))
    errors.push("boundary.repositoryPublication is required.");
  else {
    if (
      !["pending-owner-approval", "approved", "not-requested"].includes(
        report.boundary.repositoryPublication.status,
      )
    )
      errors.push("boundary.repositoryPublication.status is invalid.");
    if (report.boundary.repositoryPublication.visibilityMutationPerformed !== false)
      errors.push("visibility mutation must be explicitly false.");
  }
  if (!isRecord(report.boundary?.externalSends)) errors.push("boundary.externalSends is required.");
  else {
    if (report.boundary.externalSends.status !== "none")
      errors.push("external sends status must be none.");
    if (report.boundary.externalSends.performed !== false)
      errors.push("external sends must be explicitly absent.");
  }

  const expectedGates = QUALIFICATION_GATES.map((gate) => gate.id);
  const actualGates = Array.isArray(report.gates) ? report.gates : [];
  if (actualGates.length !== expectedGates.length)
    errors.push("Report must contain every qualification gate exactly once.");
  const seenGates = new Set();
  for (const [gateIndex, gate] of actualGates.entries()) {
    const gateLabel = `gates[${gateIndex}]`;
    exactKeys(
      gate,
      ["id", "name", "required", "status", "criteria", "evidence", "blockers"],
      gateLabel,
    );
    if (!isRecord(gate) || !text(gate.id)) {
      errors.push(`${gateLabel} must have an id.`);
      continue;
    }
    if (seenGates.has(gate.id)) errors.push(`Duplicate gate ${gate.id}.`);
    seenGates.add(gate.id);
    const definition = GATE_BY_ID.get(gate.id);
    if (!definition) {
      errors.push(`Unknown gate ${gate.id}.`);
      continue;
    }
    if (gate.name !== definition.name) errors.push(`Gate ${gate.id} has an unexpected name.`);
    if (gate.required !== true) errors.push(`Gate ${gate.id} must be required.`);
    if (!STATUSES.has(gate.status)) errors.push(`Gate ${gate.id} has an invalid status.`);
    validateEvidence(gate.evidence, `${gateLabel}.evidence`);
    validateBlockers(gate.blockers, `${gateLabel}.blockers`);
    const expectedCriteria = definition.criteria.map((criterion) => criterion.id);
    const actualCriteria = Array.isArray(gate.criteria) ? gate.criteria : [];
    if (actualCriteria.length !== expectedCriteria.length)
      errors.push(`Gate ${gate.id} must report every criterion.`);
    const seenCriteria = new Set();
    for (const [criterionIndex, criterion] of actualCriteria.entries()) {
      const criterionLabel = `${gateLabel}.criteria[${criterionIndex}]`;
      exactKeys(
        criterion,
        ["id", "name", "status", "summary", "binding", "evidence", "blockers"],
        criterionLabel,
      );
      if (!isRecord(criterion) || !text(criterion.id)) {
        errors.push(`${criterionLabel} must have an id.`);
        continue;
      }
      if (seenCriteria.has(criterion.id))
        errors.push(`Gate ${gate.id} duplicates criterion ${criterion.id}.`);
      seenCriteria.add(criterion.id);
      const criterionDefinition = definition.criteria.find((entry) => entry.id === criterion.id);
      if (!criterionDefinition) {
        errors.push(`Gate ${gate.id} contains unknown criterion ${criterion.id}.`);
        continue;
      }
      if (criterion.name !== criterionDefinition.name)
        errors.push(`Criterion ${gate.id}/${criterion.id} has an unexpected name.`);
      if (!STATUSES.has(criterion.status))
        errors.push(`Criterion ${gate.id}/${criterion.id} has an invalid status.`);
      if (criterion.summary !== undefined && !text(criterion.summary))
        errors.push(`Criterion ${gate.id}/${criterion.id}.summary must be non-empty.`);
      const expectedBinding = bindingFor(criterion.id);
      if (expectedBinding && !sameJson(criterion.binding, expectedBinding))
        errors.push(`Criterion ${gate.id}/${criterion.id} has an invalid machine binding.`);
      if (!expectedBinding && criterion.binding !== undefined)
        errors.push(`Criterion ${gate.id}/${criterion.id} has an unexpected machine binding.`);
      validateEvidence(criterion.evidence, `${criterionLabel}.evidence`);
      validateBlockers(criterion.blockers, `${criterionLabel}.blockers`);
      if (
        criterion.status === PASS &&
        (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0)
      )
        errors.push(`Passing criterion ${gate.id}/${criterion.id} has no evidence.`);
      if (
        criterion.status === PASS &&
        Array.isArray(criterion.blockers) &&
        criterion.blockers.length > 0
      )
        errors.push(`Passing criterion ${gate.id}/${criterion.id} contains blockers.`);
      if (
        criterion.status !== PASS &&
        (!Array.isArray(criterion.blockers) || criterion.blockers.length === 0)
      )
        errors.push(`Blocking criterion ${gate.id}/${criterion.id} has no blocker reason.`);
    }
    const criteriaComplete =
      actualCriteria.length === expectedCriteria.length &&
      expectedCriteria.every((criterionId) =>
        actualCriteria.some((criterion) => criterion?.id === criterionId),
      );
    const criteriaPassed =
      criteriaComplete && actualCriteria.every((criterion) => criterion?.status === PASS);
    if (
      gate.status === PASS &&
      (!criteriaPassed || !Array.isArray(gate.blockers) || gate.blockers.length > 0)
    )
      errors.push(`Passing gate ${gate.id} must have every criterion passed and zero blockers.`);
    if (gate.status !== PASS && (!Array.isArray(gate.blockers) || gate.blockers.length === 0))
      errors.push(`Blocking gate ${gate.id} has no blocker reason.`);
  }
  if (seenGates.size !== expectedGates.length || expectedGates.some((id) => !seenGates.has(id)))
    errors.push("Report is missing one or more qualification gates.");

  const blockers = Array.isArray(report.result?.blockers) ? report.result.blockers : [];
  const allPassed =
    actualGates.length === expectedGates.length &&
    actualGates.every(
      (gate) =>
        gate?.status === PASS &&
        Array.isArray(gate.criteria) &&
        gate.criteria.length > 0 &&
        gate.criteria.every((criterion) => criterion?.status === PASS),
    );
  if (report.result?.status === "qualified" && (!allPassed || blockers.length > 0))
    errors.push("A qualified report must have every criterion passed and no blockers.");
  if (report.result?.status === "blocked" && blockers.length === 0)
    errors.push("A blocked report must identify at least one blocker.");
  return { valid: errors.length === 0, errors };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function secureExistingPath(path) {
  const absolute = resolve(path);
  let current = sep;
  for (const part of absolute.slice(sep.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`Symlink paths are not accepted: ${current}`);
  }
  return {
    absolute,
    real: realpathSync(absolute),
    stats: lstatSync(absolute),
  };
}

function secureDirectory(path) {
  const info = secureExistingPath(path);
  if (!info.stats.isDirectory()) throw new Error(`Expected a directory: ${path}`);
  return info;
}

function secureFile(path) {
  const info = secureExistingPath(path);
  if (!info.stats.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return info;
}

function secureRead(path) {
  secureFile(path);
  return readFileSync(path);
}

function secureChildPath(parent, child, label = "path") {
  const parentInfo = secureDirectory(parent);
  const target = resolve(parentInfo.absolute, child);
  if (target === parentInfo.absolute || !target.startsWith(`${parentInfo.absolute}${sep}`)) {
    throw new Error(`${label} escapes its containing directory: ${child}`);
  }
  const targetInfo = secureExistingPath(target);
  if (
    targetInfo.real !== parentInfo.real &&
    !targetInfo.real.startsWith(`${parentInfo.real}${sep}`)
  ) {
    throw new Error(`${label} resolves outside its containing directory: ${child}`);
  }
  return targetInfo;
}

function secureBundleFiles(root) {
  const files = [];
  function visit(directory, prefix) {
    secureDirectory(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = secureExistingPath(child);
      if (info.stats.isDirectory()) visit(child, childPrefix);
      else if (info.stats.isFile()) files.push(childPrefix);
      else throw new Error(`Unsupported filesystem entry in evidence bundle: ${childPrefix}`);
    }
  }
  visit(root, "");
  return files;
}

function parseJson(path, blockers) {
  try {
    return JSON.parse(secureRead(path).toString("utf8"));
  } catch (error) {
    blockers.push(
      `Unable to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function xmlAttributes(tag, errors, label) {
  const match = tag.match(/^<[^\s>]+\b([^>]*)>$/);
  if (!match) {
    errors.push(`${label} has an invalid opening tag.`);
    return {};
  }
  const attributes = {};
  const source = match[1].replace(/\/\s*$/, "");
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let cursor = 0;
  for (const attribute of source.matchAll(attributePattern)) {
    if (source.slice(cursor, attribute.index).trim())
      errors.push(`${label} contains malformed attributes.`);
    const [, name, value] = attribute;
    if (Object.hasOwn(attributes, name)) errors.push(`${label} duplicates attribute ${name}.`);
    attributes[name] = value;
    cursor = attribute.index + attribute[0].length;
  }
  if (source.slice(cursor).trim()) errors.push(`${label} contains malformed attributes.`);
  return attributes;
}

function junitCounts(xml) {
  const structuralErrors = [];
  if (typeof xml !== "string") return null;
  const openings = [...xml.matchAll(/<testsuite\b[^>]*>/g)];
  const closings = [...xml.matchAll(/<\/testsuite\s*>/g)];
  if (openings.length !== 1 || closings.length !== 1) {
    structuralErrors.push("JUnit must contain exactly one testsuite element.");
    return { tests: null, failures: null, skipped: null, errors: null, ids: [], structuralErrors };
  }
  const opening = openings[0][0];
  const openingEnd = openings[0].index + opening.length;
  const closingIndex = closings[0].index;
  const prefix = xml.slice(0, openings[0].index).replace(/^\s*<\?xml[^?]*\?>\s*$/s, "");
  const suffix = xml.slice(closingIndex + closings[0][0].length).trim();
  if (prefix.trim() || suffix)
    structuralErrors.push("JUnit has content outside its testsuite root.");
  const suiteAttributes = xmlAttributes(opening, structuralErrors, "JUnit testsuite");
  const number = (name, required = true) => {
    if (!Object.hasOwn(suiteAttributes, name)) {
      if (required) structuralErrors.push(`JUnit testsuite is missing ${name}.`);
      return required ? null : 0;
    }
    if (!/^\d+$/.test(suiteAttributes[name])) {
      structuralErrors.push(`JUnit ${name} must be a non-negative integer.`);
      return null;
    }
    return Number(suiteAttributes[name]);
  };
  const tests = number("tests");
  const failures = number("failures");
  const skipped = number("skipped");
  const errors = number("errors", false);
  const body = xml.slice(openingEnd, closingIndex);
  const testcasePattern = /<testcase\b[^>]*(?:\/>|>[\s\S]*?<\/testcase\s*>)/g;
  const outcomePattern =
    /<(failure|flakyFailure|error|skipped)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:failure|flakyFailure|error|skipped)\s*>)/g;
  const ids = [];
  const outcomes = { failure: 0, flakyFailure: 0, error: 0, skipped: 0 };
  let cursor = 0;
  for (const match of body.matchAll(testcasePattern)) {
    if (body.slice(cursor, match.index).trim())
      structuralErrors.push("JUnit has non-testcase content.");
    const testcase = match[0];
    const openEnd = testcase.indexOf(">");
    const openTag = testcase.slice(0, openEnd + 1);
    const attributes = xmlAttributes(openTag, structuralErrors, "JUnit testcase");
    const id = attributes.name;
    if (typeof id !== "string" || id.length === 0)
      structuralErrors.push("JUnit testcase is missing name.");
    else if (ids.includes(id)) structuralErrors.push(`JUnit duplicates testcase ${id}.`);
    else ids.push(id);
    const selfClosing = /\/\s*>$/.test(openTag);
    const inner = selfClosing
      ? ""
      : testcase.slice(openEnd + 1, testcase.lastIndexOf("</testcase"));
    const testcaseOutcomes = [...inner.matchAll(outcomePattern)];
    const remainder = inner.replace(outcomePattern, "").trim();
    if (remainder)
      structuralErrors.push(`JUnit testcase ${id || "<unnamed>"} has unexpected content.`);
    if (testcaseOutcomes.length > 1)
      structuralErrors.push(`JUnit testcase ${id || "<unnamed>"} has multiple outcomes.`);
    if (testcaseOutcomes.length === 1) outcomes[testcaseOutcomes[0][1]] += 1;
    cursor = match.index + testcase.length;
  }
  if (body.slice(cursor).trim())
    structuralErrors.push("JUnit has content outside testcase elements.");
  const structuralFailures = outcomes.failure;
  const structuralErrorsCount = outcomes.error;
  const structuralSkipped = outcomes.skipped;
  if (outcomes.flakyFailure > 0)
    structuralErrors.push("JUnit contains flakyFailure recovery evidence.");
  if (
    tests === null ||
    failures === null ||
    skipped === null ||
    errors === null ||
    tests !== ids.length ||
    failures !== structuralFailures ||
    skipped !== structuralSkipped ||
    errors !== structuralErrorsCount ||
    tests - failures - skipped - errors !==
      ids.length - structuralFailures - structuralSkipped - structuralErrorsCount
  ) {
    structuralErrors.push("JUnit aggregate counts disagree with testcase elements.");
  }
  return { tests, failures, skipped, errors, ids, structuralErrors };
}

function readJsonl(path, blockers) {
  try {
    return secureRead(path)
      .toString("utf8")
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
  const expectedFiles = [
    "README.md",
    "junit.xml",
    "metadata.json",
    "raw/initial-results.jsonl",
    "raw/initial-summary.json",
  ];
  if (!fullSha(candidateSha))
    blockers.push("The evidence candidate must be a full lowercase commit SHA.");
  let bundle;
  try {
    const bundleInfo = secureChildPath(resolvedRoot, bundlePath ?? "", "Evidence bundle");
    if (!bundleInfo.stats.isDirectory()) throw new Error("Evidence bundle is not a directory.");
    const rootInfo = secureDirectory(resolvedRoot);
    if (
      bundleInfo.real !== rootInfo.real &&
      !bundleInfo.real.startsWith(`${rootInfo.real}${sep}`)
    ) {
      throw new Error("Evidence bundle resolves outside the repository root.");
    }
    bundle = bundleInfo.absolute;
  } catch (error) {
    return {
      status: "blocked",
      blockers: [
        ...blockers,
        error instanceof Error ? error.message : "Evidence bundle path is invalid.",
      ],
      evidence: [],
    };
  }

  let actualFiles;
  try {
    actualFiles = secureBundleFiles(bundle);
  } catch (error) {
    return {
      status: "blocked",
      blockers: [
        ...blockers,
        error instanceof Error ? error.message : "Unable to enumerate evidence bundle.",
      ],
      evidence: [],
    };
  }
  const allowedFiles = new Set([...expectedFiles, "SHA256SUMS"]);
  for (const path of actualFiles) {
    if (!allowedFiles.has(path)) {
      blockers.push(`Evidence bundle contains an unexpected file: ${path}.`);
      if (/retry/i.test(path)) blockers.push(`Retry artifact is not accepted: ${path}.`);
    }
  }
  const metadata = parseJson(join(bundle, "metadata.json"), blockers);
  const rows = readJsonl(join(bundle, "raw/initial-results.jsonl"), blockers);
  const summary = parseJson(join(bundle, "raw/initial-summary.json"), blockers);
  let junit = null;
  try {
    junit = junitCounts(secureRead(join(bundle, "junit.xml")).toString("utf8"));
  } catch (error) {
    blockers.push(
      `Unable to read ${join(bundle, "junit.xml")}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (junit?.structuralErrors?.length) blockers.push(...junit.structuralErrors);
  if (!metadata || !isRecord(metadata)) blockers.push("metadata.json is not an object.");
  if (metadata?.schemaVersion !== 1) blockers.push("Evidence metadata schemaVersion must be 1.");
  if (metadata?.suite !== "deterministic")
    blockers.push("Evidence metadata is not a deterministic suite.");
  if (metadata?.sourceCommit !== candidateSha)
    blockers.push("Evidence metadata is stale for the candidate commit.");
  const counts = metadata?.counts;
  const metadataCounts = {};
  if (!isRecord(counts)) {
    blockers.push("Evidence metadata counts must be an object with every count field.");
  } else {
    for (const key of METADATA_COUNT_FIELDS) {
      if (!Number.isInteger(counts[key]) || counts[key] < 0) {
        blockers.push(`Evidence metadata count ${key} must be a non-negative integer.`);
      } else metadataCounts[key] = counts[key];
    }
  }
  if (Number(metadataCounts.total) <= 0)
    blockers.push("Evidence metadata has no positive result total.");
  if (
    !isRecord(metadata?.workflow) ||
    metadata.workflow.trigger !== "workflow_dispatch" ||
    typeof metadata.workflow.url !== "string" ||
    metadata.workflow.url.length === 0 ||
    typeof metadata.workflow.command !== "string" ||
    metadata.workflow.command.length === 0
  )
    blockers.push("Evidence metadata workflow is incomplete.");
  if (
    !isRecord(metadata?.configuration) ||
    typeof metadata.configuration.agentModel !== "string" ||
    metadata.configuration.agentModel.length === 0 ||
    !(
      typeof metadata.configuration.eveVersion === "string" ||
      metadata.configuration.eveVersion === null
    ) ||
    typeof metadata.configuration.database !== "string" ||
    metadata.configuration.database.length === 0
  )
    blockers.push("Evidence metadata configuration is incomplete.");
  if (
    !isRecord(metadata?.timestamps) ||
    !timestamp(metadata.timestamps.startedAt) ||
    !timestamp(metadata.timestamps.completedAt) ||
    !timestamp(metadata.timestamps.packagedAt)
  )
    blockers.push("Evidence metadata timestamps are incomplete.");
  const metadataEvalIds = metadata?.evalIds;
  if (!uniqueStringIds(metadataEvalIds) || metadataEvalIds.length !== metadataCounts.total)
    blockers.push("Evidence metadata evalIds must be a unique complete eval set.");
  if (metadata?.clean !== true || metadata?.exitCode !== 0)
    blockers.push("The deterministic run was not clean with exit code 0.");
  if (
    !isRecord(metadata?.retry) ||
    metadata.retry.attempted !== false ||
    metadata.retry.rounds !== 0
  )
    blockers.push("Retry metadata must explicitly say attempted=false and rounds=0.");
  if (
    metadataCounts.failed !== 0 ||
    metadataCounts.skipped !== 0 ||
    metadataCounts.errored !== 0 ||
    metadataCounts.passed !== metadataCounts.total
  )
    blockers.push("Deterministic counts include a failure, skip, error, or incomplete pass total.");
  const statuses = metadata?.statuses;
  if (
    !isRecord(statuses) ||
    Object.keys(statuses).length !== 1 ||
    statuses.completed !== metadataCounts.total
  ) {
    blockers.push("Evidence metadata statuses must contain only completed with the exact total.");
  }
  for (const status of Object.keys(isRecord(statuses) ? statuses : {})) {
    if (status !== COMPLETED) blockers.push(`Evidence contains a non-completed status: ${status}.`);
  }
  for (const field of ["partial", "recovered", "stale", "waiting"]) {
    if (metadata?.[field] === true) blockers.push(`Evidence metadata is marked ${field}.`);
  }

  const summaryCounts = {};
  let summaryEvalIds = [];
  if (!isRecord(summary)) {
    blockers.push("raw/initial-summary.json must be an object with every count field.");
  } else {
    for (const key of COUNT_FIELDS) {
      if (!Number.isInteger(summary[key]) || summary[key] < 0) {
        blockers.push(`Raw summary count ${key} must be a non-negative integer.`);
      } else summaryCounts[key] = summary[key];
    }
    if (!Array.isArray(summary.evals)) {
      blockers.push("Raw summary must contain a complete evals array.");
    } else {
      if (!timestamp(summary.startedAt) || !timestamp(summary.completedAt))
        blockers.push("Raw summary timestamps must include valid startedAt and completedAt.");
      summaryEvalIds = summary.evals.map((entry) => entry?.id);
      if (summary.evals.length !== summaryCounts.totalEvals)
        blockers.push("Raw summary eval count disagrees with totalEvals.");
      if (!uniqueStringIds(summaryEvalIds))
        blockers.push("Raw summary eval IDs must be unique non-empty strings.");
      for (const entry of summary.evals) {
        if (entry?.result?.status !== COMPLETED)
          blockers.push("Raw summary contains a non-completed eval status.");
      }
    }
  }
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
    if (!["passed", "failed", "skipped", "errored"].includes(row?.verdict))
      blockers.push("Evidence JSONL contains an unknown verdict.");
    else rowCounts[row.verdict] += 1;
    if (row?.status !== COMPLETED) {
      blockers.push("Evidence JSONL contains a non-completed status.");
    } else rowCounts.statuses[COMPLETED] = (rowCounts.statuses[COMPLETED] ?? 0) + 1;
  }
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

  try {
    const readme = secureRead(join(bundle, "README.md")).toString("utf8");
    if (!readme.includes(`Source commit | \`${candidateSha}\``))
      blockers.push("README does not name the exact candidate source commit.");
  } catch (error) {
    blockers.push(
      `Unable to read README.md: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const checksumPath = join(bundle, "SHA256SUMS");
  const checksumEntries = [];
  try {
    for (const line of secureRead(checksumPath).toString("utf8").split(/\r?\n/).filter(Boolean)) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (!match) {
        blockers.push(`Invalid checksum line: ${line}`);
        continue;
      }
      if (checksumEntries.some((entry) => entry.path === match[2])) {
        blockers.push(`Duplicate checksum path: ${match[2]}`);
      } else checksumEntries.push({ sha256: match[1], path: match[2] });
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
    try {
      const path = secureChildPath(bundle, entry.path, "Checksum path").absolute;
      if (sha256(secureRead(path)) !== entry.sha256)
        blockers.push(`Checksum mismatch for ${entry.path}.`);
    } catch (error) {
      blockers.push(
        `Checksum path is missing, unsafe, or escapes the bundle: ${entry.path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  const evidence = [];
  for (const path of expectedFiles) {
    try {
      const absolute = secureChildPath(bundle, path, "Evidence path").absolute;
      evidence.push({
        path: relative(resolvedRoot, absolute).split(sep).join("/"),
        sourceCommit: candidateSha,
        sha256: sha256(secureRead(absolute)),
        format: path.endsWith(".json")
          ? "json"
          : path.endsWith(".jsonl")
            ? "jsonl"
            : path.endsWith(".xml")
              ? "junit"
              : path.endsWith(".md")
                ? "markdown"
                : "sha256sums",
      });
    } catch (error) {
      blockers.push(
        `Evidence file is missing or unsafe: ${path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return { status: blockers.length === 0 ? PASS : "blocked", blockers, evidence };
}

/** Verify tracked evidence bytes against the report's candidate and digests. */
export function verifyEvidenceFiles({ root = process.cwd(), candidateSha, evidence }) {
  const blockers = [];
  const resolvedRoot = resolve(root);
  const entries = Array.isArray(evidence) ? evidence : [];
  if (entries.length === 0) blockers.push("At least one exact evidence record is required.");
  for (const entry of entries) {
    if (!fullSha(entry?.sourceCommit) || entry.sourceCommit !== candidateSha) {
      blockers.push(
        `Evidence ${entry?.path ?? entry?.uri ?? "unknown"} is not tied to the candidate.`,
      );
      continue;
    }
    if (!digest(entry?.sha256)) {
      blockers.push(`Evidence ${entry?.path ?? entry?.uri ?? "unknown"} has no SHA-256 digest.`);
      continue;
    }
    if (!text(entry?.path) && !text(entry?.uri)) {
      blockers.push("Every evidence record needs a repository path or URI.");
      continue;
    }
    if (!text(entry.path)) continue;
    if (isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes("..")) {
      blockers.push(`Evidence file path is absolute or escapes the repository: ${entry.path}`);
      continue;
    }
    try {
      const treeEntry = execFileSync("git", ["ls-tree", candidateSha, "--", entry.path], {
        cwd: resolvedRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (!/^(100644|100755)\s+blob\s+[0-9a-f]{40}\t/.test(treeEntry)) {
        blockers.push(`Evidence path is not a regular candidate blob: ${entry.path}`);
        continue;
      }
      const bytes = execFileSync("git", ["show", `${candidateSha}:${entry.path}`], {
        cwd: resolvedRoot,
        encoding: null,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (sha256(bytes) !== entry.sha256)
        blockers.push(`Evidence digest mismatch in candidate blob: ${entry.path}`);
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
  return JSON.parse(secureRead(resolve(path)).toString("utf8"));
}

function outputLocation(repoRoot, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0)
    throw new Error("Output path is required when --output is supplied.");
  if (isAbsolute(requestedPath) || requestedPath.split(/[\\/]/).includes(".."))
    throw new Error("Output path must be relative and cannot escape the repository.");
  const repository = secureDirectory(repoRoot);
  const outputRoot = resolve(repository.absolute, QUALIFICATION_OUTPUT_ROOT);
  const outputPath = resolve(repository.absolute, requestedPath);
  if (outputPath === outputRoot || !outputPath.startsWith(`${outputRoot}${sep}`))
    throw new Error(`Output path must remain under ${QUALIFICATION_OUTPUT_ROOT}.`);
  if (basename(outputPath) === "." || basename(outputPath) === "..")
    throw new Error("Output path must name a report file.");

  const parent = dirname(outputPath);
  const missing = [];
  let current = repository.absolute;
  const components = relative(repository.absolute, parent).split(sep).filter(Boolean);
  for (const component of components) {
    current = join(current, component);
    if (missing.length > 0) {
      missing.push(current);
      continue;
    }
    try {
      const info = secureExistingPath(current);
      if (!info.stats.isDirectory())
        throw new Error(`Output component is not a directory: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(current);
    }
  }
  return { outputPath, parent, missing };
}

function writeOutput(repoRoot, requestedPath, contents) {
  const location = outputLocation(repoRoot, requestedPath);
  for (const directory of location.missing) {
    mkdirSync(directory);
    secureDirectory(directory);
  }
  const parent = secureDirectory(location.parent);
  try {
    const existing = secureExistingPath(location.outputPath);
    if (!existing.stats.isFile())
      throw new Error(`Output path is not a regular file: ${location.outputPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporaryPath = join(
    parent.absolute,
    `.${basename(location.outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  let descriptor;
  let operationError;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const bytes = Buffer.from(contents, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    secureDirectory(parent.absolute);
    try {
      const existing = secureExistingPath(location.outputPath);
      if (!existing.stats.isFile())
        throw new Error(`Output path is not a regular file: ${location.outputPath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    renameSync(temporaryPath, location.outputPath);
  } catch (error) {
    operationError = error;
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      if (operationError === undefined) operationError = error;
    }
  }
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    if (error?.code !== "ENOENT" && operationError === undefined) operationError = error;
  }
  if (operationError !== undefined) throw operationError;
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
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  if (actual !== candidateSha)
    throw new Error(`Checked out ${actual}, not requested candidate ${candidateSha}.`);
  const inputPath = argument("--input");
  const inputValue = inputPath ? readInput(inputPath) : { candidateSha, gates: {} };
  const input = isRecord(inputValue) ? inputValue : {};
  if (text(input.candidateSha) && input.candidateSha !== candidateSha)
    throw new Error(`Input names ${input.candidateSha}, not candidate ${candidateSha}.`);
  if (text(input.candidate?.commit) && input.candidate.commit !== candidateSha)
    throw new Error(
      `Input candidate.commit names ${input.candidate.commit}, not candidate ${candidateSha}.`,
    );
  const report = composeQualificationReport({ ...input, candidateSha });
  const outputPath = argument("--output");
  if (outputPath) writeOutput(repoRoot, outputPath, `${JSON.stringify(report, null, 2)}\n`);
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
