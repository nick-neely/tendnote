import { isAbsolute } from "node:path";
import {
  bindingFor,
  digest,
  fullSha,
  GATE_BY_ID,
  isRecord,
  PASS,
  QUALIFICATION_GATES,
  QUALIFICATION_KIND,
  QUALIFICATION_SCHEMA_VERSION,
  REPOSITORY,
  STATUSES,
  sameJson,
  text,
  timestamp,
} from "./contract.mjs";

/**
 * Validate a serialized report structurally, without trusting anything it
 * claims about itself. `result.status` is re-derived from the gates and
 * criteria, so a report cannot declare itself qualified while carrying a
 * blocked criterion, a missing gate, or evidence tied to another commit.
 *
 * Every check appends to a shared `errors` array rather than throwing, because
 * the caller needs the complete list of contract violations in one pass.
 */

const REPORT_KEYS = [
  "schemaVersion",
  "kind",
  "repository",
  "generatedAt",
  "candidate",
  "result",
  "gates",
  "boundary",
];
const CANDIDATE_KEYS = ["commit", "visibility", "immutable"];
const RESULT_KEYS = ["status", "clean", "blockers"];
const BLOCKER_KEYS = ["gateId", "criterionId", "code", "message"];
const EVIDENCE_KEYS = ["path", "uri", "sourceCommit", "sha256", "format", "description"];
const GATE_KEYS = ["id", "name", "required", "status", "criteria", "evidence", "blockers"];
const CRITERION_KEYS = ["id", "name", "status", "summary", "binding", "evidence", "blockers"];
const VISIBILITIES = ["private", "public", "unknown"];
const PUBLICATION_STATUSES = ["pending-owner-approval", "approved", "not-requested"];

function exactKeys(errors, value, allowed, label) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} contains unknown property ${key}.`);
  }
}

function validateBlockers(errors, value, label) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    exactKeys(errors, entry, BLOCKER_KEYS, `${label}[${index}]`);
    if (!isRecord(entry) || !text(entry.gateId) || !text(entry.code) || !text(entry.message))
      errors.push(`${label}[${index}] must have gateId, code, and message.`);
    if (entry?.criterionId !== undefined && !text(entry.criterionId))
      errors.push(`${label}[${index}].criterionId must be non-empty when present.`);
  }
}

function validateEvidenceLocation(errors, entry, label) {
  if (!isRecord(entry) || (!text(entry.path) && !text(entry.uri)))
    errors.push(`${label} needs a path or URI.`);
  if (entry?.path !== undefined && typeof entry.path !== "string")
    errors.push(`${label}.path must be a string.`);
  if (
    typeof entry?.path === "string" &&
    entry.path &&
    (isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes(".."))
  )
    errors.push(`${label}.path must remain within its evidence root.`);
  if (entry?.uri !== undefined && typeof entry.uri !== "string")
    errors.push(`${label}.uri must be a string.`);
  if (typeof entry?.uri === "string" && entry.uri) {
    try {
      new URL(entry.uri);
    } catch {
      errors.push(`${label}.uri must be a valid URI.`);
    }
  }
}

function validateEvidence(errors, value, label, candidateCommit) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    const itemLabel = `${label}[${index}]`;
    exactKeys(errors, entry, EVIDENCE_KEYS, itemLabel);
    validateEvidenceLocation(errors, entry, itemLabel);
    if (!fullSha(entry?.sourceCommit) || entry.sourceCommit !== candidateCommit)
      errors.push(`${itemLabel}.sourceCommit must equal candidate.commit.`);
    if (!digest(entry?.sha256)) errors.push(`${itemLabel}.sha256 must be a SHA-256 digest.`);
    if (entry?.format !== undefined && !text(entry.format))
      errors.push(`${itemLabel}.format must be non-empty.`);
    if (entry?.description !== undefined && !text(entry.description))
      errors.push(`${itemLabel}.description must be non-empty.`);
  }
}

function validateHeader(errors, report) {
  exactKeys(errors, report, REPORT_KEYS, "Report");
  if (report.schemaVersion !== QUALIFICATION_SCHEMA_VERSION)
    errors.push("Unsupported schemaVersion.");
  if (report.kind !== QUALIFICATION_KIND) errors.push("Unexpected report kind.");
  if (report.repository !== REPOSITORY) errors.push(`repository must be ${REPOSITORY}.`);
  if (!timestamp(report.generatedAt)) errors.push("generatedAt must be an ISO UTC timestamp.");
}

function validateCandidate(errors, report) {
  exactKeys(errors, report.candidate, CANDIDATE_KEYS, "candidate");
  if (!isRecord(report.candidate) || !fullSha(report.candidate?.commit))
    errors.push("candidate.commit must be a full lowercase SHA.");
  if (!isRecord(report.candidate) || !VISIBILITIES.includes(report.candidate.visibility))
    errors.push("candidate.visibility must be private, public, or unknown.");
  if (report.candidate?.immutable !== true) errors.push("candidate.immutable must be true.");
}

function validateResultShape(errors, report) {
  exactKeys(errors, report.result, RESULT_KEYS, "result");
  if (!isRecord(report.result) || !["blocked", "qualified"].includes(report.result?.status))
    errors.push("result.status must be blocked or qualified.");
  if (typeof report.result?.clean !== "boolean") errors.push("result.clean must be boolean.");
  if (
    typeof report.result?.clean === "boolean" &&
    report.result.clean !== (report.result.status === "qualified")
  )
    errors.push("result.clean must agree with result.status.");
  validateBlockers(errors, report.result?.blockers, "result.blockers");
}

function validateBoundary(errors, report) {
  const boundary = report.boundary;
  exactKeys(errors, boundary, ["repositoryPublication", "externalSends"], "boundary");
  exactKeys(
    errors,
    boundary?.repositoryPublication,
    ["status", "visibilityMutationPerformed"],
    "boundary.repositoryPublication",
  );
  exactKeys(errors, boundary?.externalSends, ["status", "performed"], "boundary.externalSends");
  if (!isRecord(boundary)) errors.push("boundary is required.");
  if (!isRecord(boundary?.repositoryPublication)) {
    errors.push("boundary.repositoryPublication is required.");
  } else {
    if (!PUBLICATION_STATUSES.includes(boundary.repositoryPublication.status))
      errors.push("boundary.repositoryPublication.status is invalid.");
    if (boundary.repositoryPublication.visibilityMutationPerformed !== false)
      errors.push("visibility mutation must be explicitly false.");
  }
  if (!isRecord(boundary?.externalSends)) {
    errors.push("boundary.externalSends is required.");
  } else {
    if (boundary.externalSends.status !== "none")
      errors.push("external sends status must be none.");
    if (boundary.externalSends.performed !== false)
      errors.push("external sends must be explicitly absent.");
  }
}

function validateCriterionIdentity(errors, criterion, label, definition, gateId, seen) {
  if (!isRecord(criterion) || !text(criterion.id)) {
    errors.push(`${label} must have an id.`);
    return null;
  }
  if (seen.has(criterion.id)) errors.push(`Gate ${gateId} duplicates criterion ${criterion.id}.`);
  seen.add(criterion.id);
  const criterionDefinition = definition.criteria.find((entry) => entry.id === criterion.id);
  if (!criterionDefinition) {
    errors.push(`Gate ${gateId} contains unknown criterion ${criterion.id}.`);
    return null;
  }
  return criterionDefinition;
}

function validateCriterionConsistency(errors, criterion, gateId) {
  const evidence = Array.isArray(criterion.evidence) ? criterion.evidence : null;
  const blockers = Array.isArray(criterion.blockers) ? criterion.blockers : null;
  if (criterion.status === PASS && (!evidence || evidence.length === 0))
    errors.push(`Passing criterion ${gateId}/${criterion.id} has no evidence.`);
  if (criterion.status === PASS && blockers && blockers.length > 0)
    errors.push(`Passing criterion ${gateId}/${criterion.id} contains blockers.`);
  if (criterion.status !== PASS && (!blockers || blockers.length === 0))
    errors.push(`Blocking criterion ${gateId}/${criterion.id} has no blocker reason.`);
}

function validateCriterion(errors, criterion, label, context) {
  const { definition, gateId, seen, candidateCommit } = context;
  exactKeys(errors, criterion, CRITERION_KEYS, label);
  const criterionDefinition = validateCriterionIdentity(
    errors,
    criterion,
    label,
    definition,
    gateId,
    seen,
  );
  if (!criterionDefinition) return;
  if (criterion.name !== criterionDefinition.name)
    errors.push(`Criterion ${gateId}/${criterion.id} has an unexpected name.`);
  if (!STATUSES.has(criterion.status))
    errors.push(`Criterion ${gateId}/${criterion.id} has an invalid status.`);
  if (criterion.summary !== undefined && !text(criterion.summary))
    errors.push(`Criterion ${gateId}/${criterion.id}.summary must be non-empty.`);
  const expectedBinding = bindingFor(criterion.id);
  if (expectedBinding && !sameJson(criterion.binding, expectedBinding))
    errors.push(`Criterion ${gateId}/${criterion.id} has an invalid machine binding.`);
  if (!expectedBinding && criterion.binding !== undefined)
    errors.push(`Criterion ${gateId}/${criterion.id} has an unexpected machine binding.`);
  validateEvidence(errors, criterion.evidence, `${label}.evidence`, candidateCommit);
  validateBlockers(errors, criterion.blockers, `${label}.blockers`);
  validateCriterionConsistency(errors, criterion, gateId);
}

function validateGateCriteria(errors, gate, gateLabel, definition, candidateCommit) {
  const expectedCriteria = definition.criteria.map((criterion) => criterion.id);
  const actualCriteria = Array.isArray(gate.criteria) ? gate.criteria : [];
  if (actualCriteria.length !== expectedCriteria.length)
    errors.push(`Gate ${gate.id} must report every criterion.`);
  const seen = new Set();
  for (const [index, criterion] of actualCriteria.entries()) {
    validateCriterion(errors, criterion, `${gateLabel}.criteria[${index}]`, {
      definition,
      gateId: gate.id,
      seen,
      candidateCommit,
    });
  }
  const complete =
    actualCriteria.length === expectedCriteria.length &&
    expectedCriteria.every((criterionId) =>
      actualCriteria.some((criterion) => criterion?.id === criterionId),
    );
  return complete && actualCriteria.every((criterion) => criterion?.status === PASS);
}

function validateGate(errors, gate, gateLabel, context) {
  const { seenGates, candidateCommit } = context;
  exactKeys(errors, gate, GATE_KEYS, gateLabel);
  if (!isRecord(gate) || !text(gate.id)) {
    errors.push(`${gateLabel} must have an id.`);
    return;
  }
  if (seenGates.has(gate.id)) errors.push(`Duplicate gate ${gate.id}.`);
  seenGates.add(gate.id);
  const definition = GATE_BY_ID.get(gate.id);
  if (!definition) {
    errors.push(`Unknown gate ${gate.id}.`);
    return;
  }
  if (gate.name !== definition.name) errors.push(`Gate ${gate.id} has an unexpected name.`);
  if (gate.required !== true) errors.push(`Gate ${gate.id} must be required.`);
  if (!STATUSES.has(gate.status)) errors.push(`Gate ${gate.id} has an invalid status.`);
  validateEvidence(errors, gate.evidence, `${gateLabel}.evidence`, candidateCommit);
  validateBlockers(errors, gate.blockers, `${gateLabel}.blockers`);
  const criteriaPassed = validateGateCriteria(errors, gate, gateLabel, definition, candidateCommit);
  const gateBlockers = Array.isArray(gate.blockers) ? gate.blockers : null;
  if (gate.status === PASS && (!criteriaPassed || !gateBlockers || gateBlockers.length > 0))
    errors.push(`Passing gate ${gate.id} must have every criterion passed and zero blockers.`);
  if (gate.status !== PASS && (!gateBlockers || gateBlockers.length === 0))
    errors.push(`Blocking gate ${gate.id} has no blocker reason.`);
}

function validateGates(errors, report) {
  const expectedGates = QUALIFICATION_GATES.map((gate) => gate.id);
  const actualGates = Array.isArray(report.gates) ? report.gates : [];
  if (actualGates.length !== expectedGates.length)
    errors.push("Report must contain every qualification gate exactly once.");
  const seenGates = new Set();
  for (const [index, gate] of actualGates.entries()) {
    validateGate(errors, gate, `gates[${index}]`, {
      seenGates,
      candidateCommit: report.candidate?.commit,
    });
  }
  if (seenGates.size !== expectedGates.length || expectedGates.some((id) => !seenGates.has(id)))
    errors.push("Report is missing one or more qualification gates.");
  return { expectedGates, actualGates };
}

/** Re-derive the headline verdict rather than believing `result.status`. */
function validateDerivedVerdict(errors, report, expectedGates, actualGates) {
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
}

export function validateQualificationReport(report) {
  if (!isRecord(report)) return { valid: false, errors: ["Report must be an object."] };
  const errors = [];
  validateHeader(errors, report);
  validateCandidate(errors, report);
  validateResultShape(errors, report);
  validateBoundary(errors, report);
  const { expectedGates, actualGates } = validateGates(errors, report);
  validateDerivedVerdict(errors, report, expectedGates, actualGates);
  return { valid: errors.length === 0, errors };
}
