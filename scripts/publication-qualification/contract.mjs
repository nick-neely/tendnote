export const QUALIFICATION_SCHEMA_VERSION = 1;
export const QUALIFICATION_KIND = "tendnote.phase-9a.publication-qualification";
export const REPOSITORY = "nick-neely/tendnote";
export const CANONICAL_ORIGIN = "https://tendnote.com";
const FORMER_HOST = ["tendnote", "stacklet", "app"].join(".");
export const FORMER_ORIGIN = `https://${FORMER_HOST}`;

const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const STATUSES = new Set([
  "passed",
  "blocked",
  "pending",
  "failed",
  "skipped",
  "recovered",
  "stale",
  "not-run",
]);
export const PASS = "passed";
export const COMPLETED = "completed";
export const QUALIFICATION_OUTPUT_ROOT = "evidence/qualification";
export const COUNT_FIELDS = Object.freeze(["totalEvals", "passed", "failed", "skipped", "errored"]);
export const METADATA_COUNT_FIELDS = Object.freeze([
  "total",
  "passed",
  "failed",
  "skipped",
  "errored",
]);

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

export const GATE_BY_ID = new Map(QUALIFICATION_GATES.map((gate) => [gate.id, gate]));

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function fullSha(value) {
  return typeof value === "string" && FULL_SHA.test(value);
}

export function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

export function timestamp(value) {
  return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function blocker(gateId, message, criterionId, code = "blocked") {
  return { gateId, ...(criterionId ? { criterionId } : {}), code, message };
}

export function bindingFor(criterionId) {
  return QUALIFICATION_BINDINGS[criterionId];
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function uniqueStringIds(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(value).size === value.length
  );
}

export function sameIdSet(left, right) {
  return (
    uniqueStringIds(left) &&
    uniqueStringIds(right) &&
    left.length === right.length &&
    left.every((id) => right.includes(id))
  );
}

export function dedupeBlockers(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
