import { isAbsolute } from "node:path";
import {
  bindingFor,
  blocker,
  dedupeBlockers,
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
import { validateQualificationReport } from "./report-validation.mjs";

function pushEntryBlocker(blockers, gateId, code, message, criterionId) {
  blockers.push(blocker(gateId, message, criterionId, code));
}

function criteriaEntriesFromArray(value, gateId, expected, blockers) {
  const entries = new Map();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || !text(entry.id)) {
      pushEntryBlocker(
        blockers,
        gateId,
        "invalid-criterion",
        `Criterion entry ${index + 1} has no id.`,
      );
      continue;
    }
    if (entries.has(entry.id)) {
      pushEntryBlocker(
        blockers,
        gateId,
        "duplicate-criterion",
        `Duplicate criterion ${entry.id}.`,
        entry.id,
      );
      continue;
    }
    if (!expected.has(entry.id)) {
      pushEntryBlocker(
        blockers,
        gateId,
        "unknown-criterion",
        `Unknown criterion ${entry.id}.`,
        entry.id,
      );
    }
    entries.set(entry.id, entry);
  }
  return entries;
}

function criteriaEntriesFromObject(value, gateId, expected, blockers) {
  const entries = new Map();
  for (const [id, entry] of Object.entries(value)) {
    if (entries.has(id)) {
      pushEntryBlocker(blockers, gateId, "duplicate-criterion", `Duplicate criterion ${id}.`, id);
      continue;
    }
    if (!expected.has(id))
      pushEntryBlocker(blockers, gateId, "unknown-criterion", `Unknown criterion ${id}.`, id);
    entries.set(id, entry);
  }
  return entries;
}

function criteriaEntries(value, gateId, definitions, blockers) {
  if (value === undefined) return new Map();
  const expected = new Set(definitions.map((definition) => definition.id));
  if (Array.isArray(value)) return criteriaEntriesFromArray(value, gateId, expected, blockers);
  if (!isRecord(value)) {
    pushEntryBlocker(blockers, gateId, "invalid-criteria", "Criteria must be an object or array.");
    return new Map();
  }
  return criteriaEntriesFromObject(value, gateId, expected, blockers);
}

/**
 * Blockers for one evidence entry, in the order the contract reports them:
 * location, then provenance, then digest. `stale-source` is reported only for
 * a well-formed commit that names something other than the candidate - a
 * malformed commit is already an `invalid-evidence` blocker.
 */
function evidenceEntryBlockers(parsed, candidateSha, gateId, criterionId, index) {
  const { path, uri, sourceCommit, sha256 } = parsed;
  const result = [];
  const label = `Evidence entry ${index + 1}`;
  const push = (code, message) => pushEntryBlocker(result, gateId, code, message, criterionId);
  if (!path && !uri) push("invalid-evidence", `${label} has no repository path or URI.`);
  if (path && (isAbsolute(path) || path.split(/[\\/]/).includes(".."))) {
    push("invalid-evidence", `${label} has an absolute or escaping repository path.`);
  }
  if (uri) {
    try {
      new URL(uri);
    } catch {
      push("invalid-evidence", `${label} does not contain a valid URI.`);
    }
  }
  if (!fullSha(sourceCommit)) {
    push("invalid-evidence", `${label} does not name a full lowercase source commit.`);
  } else if (sourceCommit !== candidateSha) {
    push("stale-source", `${label} is tied to ${sourceCommit}, not candidate ${candidateSha}.`);
  }
  if (!digest(sha256)) push("invalid-evidence", `${label} does not contain a SHA-256 digest.`);
  return result;
}

function evidenceEntries(value, candidateSha, gateId, criterionId) {
  if (!Array.isArray(value)) return { entries: [], blockers: [] };
  const entries = [];
  const blockers = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      pushEntryBlocker(
        blockers,
        gateId,
        "invalid-evidence",
        `Evidence entry ${index + 1} is not an object.`,
        criterionId,
      );
      continue;
    }
    const parsed = {
      path: text(raw.path),
      uri: text(raw.uri),
      sourceCommit: text(raw.sourceCommit),
      sha256: text(raw.sha256),
    };
    blockers.push(...evidenceEntryBlockers(parsed, candidateSha, gateId, criterionId, index));
    entries.push({
      ...(parsed.path ? { path: parsed.path } : {}),
      ...(parsed.uri ? { uri: parsed.uri } : {}),
      sourceCommit: parsed.sourceCommit,
      sha256: parsed.sha256,
      ...(text(raw.format) ? { format: text(raw.format) } : {}),
      ...(text(raw.description) ? { description: text(raw.description) } : {}),
    });
  }
  return { entries, blockers };
}

function rawGateMapFromArray(value, blockers) {
  const entries = new Map();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || !text(entry.id)) {
      blockers.push({ code: "invalid-gate", message: `Gate entry ${index + 1} has no id.` });
      continue;
    }
    if (entries.has(entry.id)) {
      blockers.push({ code: "duplicate-gate", message: `Duplicate gate ${entry.id}.` });
      continue;
    }
    if (!GATE_BY_ID.has(entry.id))
      blockers.push({ code: "unknown-gate", message: `Input contains unknown gate ${entry.id}.` });
    entries.set(entry.id, entry);
  }
  return entries;
}

function rawGateMapFromObject(value, blockers) {
  const entries = new Map();
  for (const [id, entry] of Object.entries(value)) {
    if (entries.has(id)) {
      blockers.push({ code: "duplicate-gate", message: `Duplicate gate ${id}.` });
      continue;
    }
    if (!GATE_BY_ID.has(id))
      blockers.push({ code: "unknown-gate", message: `Input contains unknown gate ${id}.` });
    entries.set(id, entry);
  }
  return entries;
}

function rawGateMap(value, blockers) {
  if (value === undefined) return new Map();
  if (Array.isArray(value)) return rawGateMapFromArray(value, blockers);
  if (!isRecord(value)) {
    blockers.push({ code: "invalid-gates", message: "Gates must be an object or array." });
    return new Map();
  }
  return rawGateMapFromObject(value, blockers);
}

function normalizedStatus(rawStatus, fallback) {
  return STATUSES.has(rawStatus) ? rawStatus : fallback;
}

/**
 * A non-passing status is itself a blocker. The supplied reason wins when there
 * is one; otherwise the message names what is unresolved, so a report stays
 * readable without cross-referencing the contract.
 */
function statusBlocker(gateId, status, reason, criterionId, fallbackMessage) {
  return blocker(gateId, reason || fallbackMessage, criterionId, status);
}

function criterionBindingBlockers(gateId, criterionId, value) {
  const expected = bindingFor(criterionId);
  if (expected && (!isRecord(value.binding) || !sameJson(value.binding, expected))) {
    return [
      blocker(
        gateId,
        `Criterion ${criterionId} must include its exact machine binding.`,
        criterionId,
        "missing-or-invalid-binding",
      ),
    ];
  }
  if (!expected && value.binding !== undefined) {
    return [
      blocker(
        gateId,
        `Criterion ${criterionId} contains an unexpected machine binding.`,
        criterionId,
        "unexpected-binding",
      ),
    ];
  }
  return [];
}

function normalizeCriterion(
  definition,
  provided,
  gateDefinition,
  gateStatus,
  candidateSha,
  gateEvidence,
) {
  const value = isRecord(provided) ? provided : {};
  const suppliedStatus = text(value.status);
  let status = normalizedStatus(suppliedStatus, gateStatus === PASS ? "blocked" : gateStatus);
  const blockers = [];
  if (suppliedStatus && !STATUSES.has(suppliedStatus)) {
    blockers.push(
      blocker(
        gateDefinition.id,
        `Unknown criterion status ${suppliedStatus}.`,
        definition.id,
        "invalid-status",
      ),
    );
    status = "blocked";
  }
  if (!provided && gateStatus === PASS)
    blockers.push(
      blocker(
        gateDefinition.id,
        "A passing gate must report every listed criterion.",
        definition.id,
        "missing-criterion",
      ),
    );
  blockers.push(...criterionBindingBlockers(gateDefinition.id, definition.id, value));
  if (status !== PASS)
    blockers.push(
      statusBlocker(
        gateDefinition.id,
        status,
        text(value.reason),
        definition.id,
        `Criterion ${definition.id} is ${status}.`,
      ),
    );
  const criterionEvidence = evidenceEntries(
    value.evidence,
    candidateSha,
    gateDefinition.id,
    definition.id,
  );
  blockers.push(...criterionEvidence.blockers);
  if (status === PASS && criterionEvidence.entries.length === 0)
    blockers.push(
      blocker(
        gateDefinition.id,
        "A passing criterion must have exact evidence.",
        definition.id,
        "missing-evidence",
      ),
    );
  return {
    id: definition.id,
    name: definition.name,
    status: status === PASS && blockers.length > 0 ? "blocked" : status,
    ...(bindingFor(definition.id) ? { binding: bindingFor(definition.id) } : {}),
    ...(text(value.summary) ? { summary: text(value.summary) } : {}),
    evidence:
      criterionEvidence.entries.length > 0 ? criterionEvidence.entries : gateEvidence.entries,
    blockers,
  };
}

function normalizeGate(gateDefinition, rawValue, candidateSha) {
  const raw = isRecord(rawValue) ? rawValue : {};
  const suppliedStatus = text(raw.status);
  const status = normalizedStatus(suppliedStatus, rawValue ? "blocked" : "not-run");
  const gateBlockers = [];
  if (suppliedStatus && !STATUSES.has(suppliedStatus))
    gateBlockers.push(
      blocker(
        gateDefinition.id,
        `Unknown gate status ${suppliedStatus}.`,
        undefined,
        "invalid-status",
      ),
    );
  if (status !== PASS)
    gateBlockers.push(
      statusBlocker(
        gateDefinition.id,
        status,
        text(raw.reason),
        undefined,
        `The ${gateDefinition.name} gate is ${status}.`,
      ),
    );
  const gateEvidence = evidenceEntries(raw.evidence, candidateSha, gateDefinition.id);
  gateBlockers.push(...gateEvidence.blockers);
  const providedCriteria = criteriaEntries(
    raw.criteria,
    gateDefinition.id,
    gateDefinition.criteria,
    gateBlockers,
  );
  const criteria = gateDefinition.criteria.map((definition) =>
    normalizeCriterion(
      definition,
      providedCriteria.get(definition.id),
      gateDefinition,
      status,
      candidateSha,
      gateEvidence,
    ),
  );
  gateBlockers.push(...criteria.flatMap((criterion) => criterion.blockers));
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

function boundaryObject(source, key, allowed, label, blockers) {
  const value = isRecord(source[key]) ? source[key] : {};
  if (!Object.hasOwn(source, key) || !isRecord(source[key]))
    blockers.push({
      code: "boundary-missing",
      message: `${label} boundary must be explicitly supplied.`,
    });
  for (const property of Object.keys(value)) {
    if (!allowed.includes(property))
      blockers.push({
        code: "unknown-boundary-property",
        message: `Unknown ${label} property ${property}.`,
      });
  }
  return value;
}

function validatePublicationBoundary(publication, blockers) {
  const status = text(publication.status);
  const valid = ["pending-owner-approval", "approved", "not-requested"].includes(status);
  if (!Object.hasOwn(publication, "status"))
    blockers.push({
      code: "boundary-defaulted",
      message: "repositoryPublication.status must be explicit.",
    });
  else if (!valid)
    blockers.push({
      code: "boundary-status",
      message: `Unknown repositoryPublication.status ${status || "<empty>"}.`,
    });
  else if (status !== "approved")
    blockers.push({
      code: status,
      message: `Repository publication boundary is ${status}; owner approval is required.`,
    });
  if (!Object.hasOwn(publication, "visibilityMutationPerformed"))
    blockers.push({
      code: "boundary-defaulted",
      message: "repositoryPublication.visibilityMutationPerformed must be explicit false.",
    });
  else if (typeof publication.visibilityMutationPerformed !== "boolean")
    blockers.push({
      code: "malformed-boundary-boolean",
      message: "repositoryPublication.visibilityMutationPerformed must be a boolean.",
    });
  else if (publication.visibilityMutationPerformed)
    blockers.push({
      code: "visibility-mutated",
      message: "Qualification evidence cannot claim a clean run after a visibility mutation.",
    });
  return valid ? status : "pending-owner-approval";
}

function validateSendBoundary(sends, blockers) {
  const status = text(sends.status);
  if (!Object.hasOwn(sends, "status"))
    blockers.push({
      code: "boundary-defaulted",
      message: "externalSends.status must be explicit none.",
    });
  else if (status !== "none")
    blockers.push({
      code: "external-send-status",
      message: `externalSends.status must be none, received ${status || "<empty>"}.`,
    });
  if (!Object.hasOwn(sends, "performed"))
    blockers.push({
      code: "boundary-defaulted",
      message: "externalSends.performed must be explicit false.",
    });
  else if (typeof sends.performed !== "boolean")
    blockers.push({
      code: "malformed-boundary-boolean",
      message: "externalSends.performed must be a boolean.",
    });
  else if (sends.performed)
    blockers.push({
      code: "external-send-performed",
      message: "Qualification evidence cannot authorize or imply an external send.",
    });
}

function boundary(input) {
  const source = isRecord(input) ? input : {};
  const blockers = [];
  for (const key of Object.keys(source)) {
    if (!["repositoryPublication", "externalSends"].includes(key))
      blockers.push({
        code: "unknown-boundary-property",
        message: `Unknown boundary property ${key}.`,
      });
  }
  const publication = boundaryObject(
    source,
    "repositoryPublication",
    ["status", "visibilityMutationPerformed"],
    "repositoryPublication",
    blockers,
  );
  const sends = boundaryObject(
    source,
    "externalSends",
    ["status", "performed"],
    "externalSends",
    blockers,
  );
  const publicationStatus = validatePublicationBoundary(publication, blockers);
  validateSendBoundary(sends, blockers);
  return {
    value: {
      repositoryPublication: { status: publicationStatus, visibilityMutationPerformed: false },
      externalSends: { status: "none", performed: false },
    },
    blockers,
  };
}

function candidateDetails(source) {
  const candidate = isRecord(source.candidate) ? source.candidate : {};
  const topLevel = text(source.candidateSha);
  const nested = text(candidate.commit);
  const candidateSha = topLevel || nested;
  const blockers = [];
  if (topLevel && nested && topLevel !== nested)
    blockers.push({
      code: "conflicting-candidate",
      message: `Top-level candidateSha ${topLevel} disagrees with candidate.commit ${nested}.`,
    });
  if (!fullSha(candidateSha))
    blockers.push({
      code: "invalid-candidate",
      message: "The candidate must be a full lowercase commit SHA.",
    });
  return { candidate, candidateSha, blockers };
}

/** Compose the one report consumed by the final publication decision. */
export function composeQualificationReport(input = {}) {
  const source = isRecord(input) ? input : {};
  const { candidate, candidateSha, blockers: inputBlockers } = candidateDetails(source);
  const repository = text(source.repository) || text(candidate.repository) || REPOSITORY;
  if (repository !== REPOSITORY)
    inputBlockers.push({
      code: "unexpected-repository",
      message: `Expected ${REPOSITORY}, received ${repository}.`,
    });
  const generatedAt = text(source.generatedAt) || new Date().toISOString();
  if (!timestamp(generatedAt))
    inputBlockers.push({
      code: "invalid-timestamp",
      message: "generatedAt must be an ISO UTC timestamp.",
    });
  const rawGates = rawGateMap(source.gates, inputBlockers);
  const gates = QUALIFICATION_GATES.map((definition) =>
    normalizeGate(definition, rawGates.get(definition.id), candidateSha),
  );
  const reportBoundary = boundary(source.boundary);
  inputBlockers.push(...reportBoundary.blockers);
  const blockers = [
    ...inputBlockers.map((entry) => ({ gateId: "report-contract", ...entry })),
    ...gates.flatMap((gate) => gate.blockers),
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
    result: { status, clean: status === "qualified", blockers: dedupeBlockers(blockers) },
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
