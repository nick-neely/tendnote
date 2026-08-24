import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const agreementPath = "docs/legal/individual-contributor-license-agreement.md";
const metadataPath = "docs/legal/cla-assistant-metadata.json";
const configPath = ".github/cla-assistant-desired-state.json";
const rulesetPath = ".github/rulesets/protect-main.json";
const proofSchemaPath = "docs/phase-9a/cla-gate-proof.schema.json";
const runbookPath = "docs/phase-9a/cla-enforcement-runbook.md";
const validProofPath = "docs/phase-9a/fixtures/cla-gate-proof.valid.json";
const pendingProofPath = "docs/phase-9a/fixtures/cla-gate-proof.pending.json";
const invalidProofPath = "docs/phase-9a/fixtures/cla-gate-proof.invalid.json";

const APPROVED_AGREEMENT_SHA256 =
  "c3a8e1828d9d573dedba7ddb9e38fb043032532777db9e6028c4b99e4a5545ec";
const APPROVED_METADATA_SHA256 = "2388463bcb86f1cf3a2ec38ab156060c2c553c63678c6e41bf7422d62e4adb3c";

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return createHash("sha256").update(read(relativePath), "utf8").digest("hex");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

type ProofCase = {
  kind: "unsigned" | "accepted" | "employer" | "corporate";
  proofId: string;
  status: "failure" | "pending" | "success";
  outcome: "open-unmergeable" | "eligible";
  observedAt: string;
  identity: "redacted";
};

type ProofFixture = {
  schemaVersion: "1.0";
  repository: "nick-neely/tendnote";
  commit: string;
  agreement: { version: "1.0"; sha256: string };
  ruleset: {
    id: 19995472;
    name: "Protect main";
    observedAt: string;
    requiredStatusContexts: ["Verify", "Full CI qualification", "Vercel"];
  };
  claCheck: { statusContext: string; integrationId: number };
  cases: ProofCase[];
  redaction: {
    identities: true;
    contactDetails: true;
    acceptanceRecords: true;
    temporaryPullRequests: true;
    gistReferences: true;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "repository",
  "commit",
  "agreement",
  "ruleset",
  "claCheck",
  "cases",
  "redaction",
];
const CASE_FIELDS = ["kind", "proofId", "status", "outcome", "observedAt", "identity"];
const REDACTION_FLAGS = [
  "identities",
  "contactDetails",
  "acceptanceRecords",
  "temporaryPullRequests",
  "gistReferences",
];
const FORBIDDEN_SUBSTRINGS = ["signature", "signer", "email", "account_id", "gist_url"];
const EXPECTED_CASES: Record<
  ProofCase["kind"],
  { statuses: readonly ProofCase["status"][]; outcome: ProofCase["outcome"] }
> = {
  unsigned: { statuses: ["failure", "pending"], outcome: "open-unmergeable" },
  accepted: { statuses: ["success"], outcome: "eligible" },
  employer: { statuses: ["success"], outcome: "eligible" },
  corporate: { statuses: ["success"], outcome: "eligible" },
};

function shapeErrors(proof: Partial<ProofFixture>): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in proof)) errors.push(`missing top-level field: ${key}`);
  }
  for (const key of Object.keys(proof)) {
    if (!REQUIRED_TOP_LEVEL.includes(key)) errors.push(`unexpected top-level field: ${key}`);
  }
  if (proof.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (proof.repository !== "nick-neely/tendnote") errors.push("repository is not Tendnote");
  if (typeof proof.commit !== "string" || !/^[0-9a-f]{40}$/.test(proof.commit)) {
    errors.push("commit must be a lowercase 40-character SHA");
  }
  return errors;
}

function agreementErrors(agreement: unknown): string[] {
  if (!isRecord(agreement)) return ["agreement must be an object"];
  const errors: string[] = [];
  if (agreement.version !== "1.0") errors.push("agreement version must be 1.0");
  if (agreement.sha256 !== APPROVED_AGREEMENT_SHA256) {
    errors.push("agreement hash does not match the approved ICLA");
  }
  return errors;
}

function rulesetErrors(ruleset: unknown): string[] {
  if (!isRecord(ruleset)) return ["ruleset must be an object"];
  const errors: string[] = [];
  if (ruleset.id !== 19995472) errors.push("ruleset id is not 19995472");
  if (ruleset.name !== "Protect main") errors.push("ruleset name is not Protect main");
  if (!Array.isArray(ruleset.requiredStatusContexts)) {
    errors.push("ruleset requiredStatusContexts must be an array");
  } else if (
    JSON.stringify(ruleset.requiredStatusContexts) !==
    JSON.stringify(["Verify", "Full CI qualification", "Vercel"])
  ) {
    errors.push("ruleset requiredStatusContexts changed");
  }
  return errors;
}

function claCheckErrors(claCheck: unknown): string[] {
  if (!isRecord(claCheck)) return ["claCheck must be an object"];
  const errors: string[] = [];
  for (const key of Object.keys(claCheck)) {
    if (!["statusContext", "integrationId"].includes(key)) {
      errors.push(`claCheck has unexpected field: ${key}`);
    }
  }
  if (
    typeof claCheck.statusContext !== "string" ||
    !/^\S(?:.*\S)?$/.test(claCheck.statusContext) ||
    claCheck.statusContext === "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE"
  ) {
    errors.push("claCheck status context must be observed");
  }
  if (
    typeof claCheck.integrationId !== "number" ||
    !Number.isInteger(claCheck.integrationId) ||
    claCheck.integrationId < 1
  ) {
    errors.push("claCheck integration_id must be a positive integer");
  }
  return errors;
}

function caseErrors(proofCase: unknown, index: number): string[] {
  if (!isRecord(proofCase)) return [`case ${index} must be an object`];
  const errors: string[] = [];
  for (const key of Object.keys(proofCase)) {
    if (!CASE_FIELDS.includes(key)) errors.push(`case ${index} has unexpected field: ${key}`);
  }
  const kind = proofCase.kind as ProofCase["kind"];
  const expectedCase = EXPECTED_CASES[kind];
  if (!expectedCase) return [...errors, `case ${index} has an unknown kind`];
  const status = proofCase.status as ProofCase["status"];
  if (!expectedCase.statuses.includes(status) || proofCase.outcome !== expectedCase.outcome) {
    errors.push(`${kind} case has an unexpected status/outcome`);
  }
  if (typeof proofCase.proofId !== "string" || !/^redacted-[a-z0-9-]+$/.test(proofCase.proofId)) {
    errors.push(`${kind} case proofId must be redacted`);
  }
  if (proofCase.identity !== "redacted") errors.push(`${kind} case identity must be redacted`);
  return errors;
}

function casesErrors(cases: unknown): string[] {
  if (!Array.isArray(cases) || cases.length !== 4) {
    return ["proof must contain exactly four cases"];
  }
  const errors: string[] = [];
  const kinds = cases.map((proofCase) => (isRecord(proofCase) ? proofCase.kind : undefined));
  for (const kind of ["unsigned", "accepted", "employer", "corporate"] as const) {
    if (kinds.filter((candidate) => candidate === kind).length !== 1) {
      errors.push(`proof must contain exactly one ${kind} case`);
    }
  }
  for (const [index, proofCase] of cases.entries()) errors.push(...caseErrors(proofCase, index));
  return errors;
}

function redactionErrors(redaction: unknown): string[] {
  if (!isRecord(redaction)) return ["redaction must be an object"];
  return REDACTION_FLAGS.filter((key) => redaction[key] !== true).map(
    (key) => `redaction.${key} must be true`,
  );
}

function leakErrors(value: unknown): string[] {
  const serialized = JSON.stringify(value).toLowerCase();
  return FORBIDDEN_SUBSTRINGS.filter((forbidden) => serialized.includes(forbidden)).map(
    (forbidden) => `proof contains forbidden ${forbidden} data`,
  );
}

/**
 * The redacted proof has to be complete, exact, and free of contributor
 * identity. Each part reports independently so a fixture shows every violation
 * at once rather than only the first.
 */
function validateRedactedProof(value: unknown): string[] {
  if (!isRecord(value)) return ["proof must be an object"];
  const proof = value as Partial<ProofFixture>;
  return [
    ...shapeErrors(proof),
    ...agreementErrors(proof.agreement),
    ...rulesetErrors(proof.ruleset),
    ...claCheckErrors(proof.claCheck),
    ...casesErrors(proof.cases),
    ...redactionErrors(proof.redaction),
    ...leakErrors(value),
  ];
}

const RULESET_PAYLOAD_KEYS = [
  "name",
  "target",
  "enforcement",
  "conditions",
  "rules",
  "bypass_actors",
] as const;
const RULESET_READ_ONLY_KEYS = new Set([
  "id",
  "source_type",
  "source",
  "node_id",
  "created_at",
  "updated_at",
  "current_user_can_bypass",
  "_links",
]);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function deepJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function mutableRulesetPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (!RULESET_PAYLOAD_KEYS.every((key) => key in value)) return null;
  if (
    Object.keys(value).some(
      (key) =>
        !RULESET_PAYLOAD_KEYS.includes(key as (typeof RULESET_PAYLOAD_KEYS)[number]) &&
        !RULESET_READ_ONLY_KEYS.has(key),
    )
  ) {
    return null;
  }
  return Object.fromEntries(RULESET_PAYLOAD_KEYS.map((key) => [key, value[key]]));
}

function matchesAuthorizedRulesetPayload(response: unknown, authorizedPayload: unknown): boolean {
  if (!isRecord(authorizedPayload)) return false;
  if (
    Object.keys(authorizedPayload).length !== RULESET_PAYLOAD_KEYS.length ||
    Object.keys(authorizedPayload).some(
      (key) => !RULESET_PAYLOAD_KEYS.includes(key as (typeof RULESET_PAYLOAD_KEYS)[number]),
    )
  ) {
    return false;
  }
  const responsePayload = mutableRulesetPayload(response);
  return responsePayload !== null && deepJsonEqual(responsePayload, authorizedPayload);
}

type RulesetDocument = {
  name: string;
  target: string;
  enforcement: string;
  conditions: Record<string, unknown>;
  rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
  bypass_actors: unknown[];
};

describe("external CLA enforcement contract", () => {
  it("pins the exact approved ICLA version and bytes", () => {
    const config = readJson<{
      agreement: {
        path: string;
        version: string;
        effectiveDate: string;
        sha256: string;
        gistFilename: string;
      };
    }>(configPath);

    expect(config.agreement).toEqual({
      path: agreementPath,
      version: "1.0",
      effectiveDate: "2026-08-21",
      sha256: APPROVED_AGREEMENT_SHA256,
      gistFilename: "individual-contributor-license-agreement.md",
    });
    expect(sha256(agreementPath)).toBe(APPROVED_AGREEMENT_SHA256);
    expect(read(agreementPath)).toMatch(
      /^# Tendnote Individual Contributor License Agreement \(ICLA\)/,
    );
    expect(read(agreementPath)).toMatch(/\*\*Version 1\.0 — EFFECTIVE 2026-08-21\*\*/);
  });

  it("keeps CLA Assistant metadata limited to a non-sensitive route choice", () => {
    const config = readJson<{
      metadata: {
        path: string;
        gistFilename: string;
        sha256: string;
      };
    }>(configPath);
    const metadata = readJson<Record<string, Record<string, unknown>>>(metadataPath);
    const metadataText = read(metadataPath).toLowerCase();

    expect(config.metadata).toEqual({
      path: metadataPath,
      gistFilename: "metadata",
      sha256: APPROVED_METADATA_SHA256,
    });
    expect(sha256(metadataPath)).toBe(APPROVED_METADATA_SHA256);
    expect(Object.keys(metadata)).toEqual(["rightsRoute"]);
    expect(Object.keys(metadata)).toEqual(
      expect.arrayContaining(Object.keys(metadata).filter((key) => /^[A-Za-z0-9]+$/.test(key))),
    );
    expect(metadata.rightsRoute).toEqual({
      title: "Contribution rights route",
      description:
        "Choose the route that matches who owns or controls this Contribution. This selection is not acceptance and does not replace a signed employer or corporate authorization.",
      type: {
        enum: [
          "I own the Contribution and am accepting the individual CLA.",
          "My employer authorizes this Contribution or named-contributor scope.",
          "My entity has a corporate CLA and authorized-contributor schedule.",
        ],
      },
      required: true,
    });
    expect(metadata.rightsRoute).not.toHaveProperty("githubKey");
    for (const forbiddenField of [
      "legal_name",
      "contact_email",
      "employer_name",
      "employer_address",
      "signature",
      "account_id",
      "provider",
      "raw_output",
      "prompt",
      "usage_data",
    ]) {
      expect(metadataText).not.toContain(forbiddenField);
    }
  });

  it("fails closed until the hosted service context is observed", () => {
    const config = readJson<{
      kind: string;
      runtimeConfig: boolean;
      repository: string;
      service: { name: string; url: string; configuration: string };
      enforcement: {
        required: boolean;
        observeBeforeEnforce: boolean;
        statusContext: {
          value: string | null;
          placeholder: string;
          integrationId: number | null;
          integrationIdPlaceholder: string;
        };
        rulesetId: number;
        existingRequiredStatusContexts: string[];
        preserveExistingChecks: boolean;
        removeExistingBypassActors: boolean;
        desiredBypassActors: unknown[];
        requiresPostUpdateVerification: boolean;
      };
    }>(configPath);
    const ruleset = readJson<{
      rules: Array<{
        type: string;
        parameters?: { required_status_checks?: Array<{ context: string }> };
      }>;
      bypass_actors: unknown[];
    }>(rulesetPath);
    const statusRule = ruleset.rules.find((rule) => rule.type === "required_status_checks");

    expect(config.kind).toBe("cla-assistant-desired-state");
    expect(config.runtimeConfig).toBe(false);
    expect(config.repository).toBe("nick-neely/tendnote");
    expect(config.service).toEqual({
      name: "CLA Assistant",
      url: "https://cla-assistant.io",
      configuration: "owner dashboard and linked Gist; this file is not read by the hosted service",
    });
    expect(config.enforcement.required).toBe(true);
    expect(config.enforcement.observeBeforeEnforce).toBe(true);
    expect(config.enforcement.statusContext).toEqual({
      value: "license/cla",
      placeholder: "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE",
      integrationId: 128106,
      integrationIdPlaceholder: "CLA_INTEGRATION_ID_TO_OBSERVE_LIVE",
    });
    expect(config.enforcement.rulesetId).toBe(19995472);
    expect(config.enforcement.preserveExistingChecks).toBe(true);
    expect(config.enforcement.removeExistingBypassActors).toBe(false);
    expect(config.enforcement.desiredBypassActors).toEqual([
      {
        actorId: 5,
        actorType: "RepositoryRole",
        bypassMode: "pull_request",
      },
    ]);
    expect(config.enforcement.requiresPostUpdateVerification).toBe(true);
    // The manifest exists to mirror the tracked ruleset, so the invariant is
    // that the two agree, not a third copy of the list.
    // `ci-workflow-optimization.test.ts` is what pins the ruleset itself,
    // against the verification job names that produce those contexts.
    const rulesetContexts = statusRule?.parameters?.required_status_checks?.map(
      ({ context }) => context,
    );

    expect(rulesetContexts).toContain("license/cla");
    expect(config.enforcement.existingRequiredStatusContexts).toEqual(rulesetContexts);
    expect(statusRule?.parameters?.required_status_checks).not.toContainEqual({
      context: "CLA Assistant",
    });
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ]);
  });

  it("deeply compares the post-PUT ruleset with the authorized payload", () => {
    const liveBefore = cloneJson(readJson<RulesetDocument>(rulesetPath));
    liveBefore.bypass_actors = [
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ];
    const candidate = cloneJson(liveBefore);
    const statusRule = candidate.rules.find((rule) => rule.type === "required_status_checks");
    if (!statusRule?.parameters || !Array.isArray(statusRule.parameters.required_status_checks)) {
      throw new Error("the ruleset fixture must have one required-status rule");
    }
    (statusRule.parameters.required_status_checks as Array<Record<string, unknown>>).push({
      context: "observed-cla-status",
      integration_id: 424242,
    });

    const authorizedPayload = {
      name: candidate.name,
      target: candidate.target,
      enforcement: candidate.enforcement,
      conditions: candidate.conditions,
      rules: candidate.rules,
      bypass_actors: candidate.bypass_actors,
    };
    const postPutResponse = {
      ...authorizedPayload,
      id: 19995472,
      source_type: "Repository",
      source: "nick-neely/tendnote",
      node_id: "RRS_fixture",
      created_at: "2026-08-22T00:00:00Z",
      updated_at: "2026-08-22T00:01:00Z",
      current_user_can_bypass: "pull_requests_only",
      _links: {
        self: { href: "https://api.github.com/repos/nick-neely/tendnote/rulesets/19995472" },
        html: { href: "https://github.com/nick-neely/tendnote/rules/19995472" },
      },
    };

    expect(matchesAuthorizedRulesetPayload(postPutResponse, authorizedPayload)).toBe(true);

    const changedNestedParameter = cloneJson(postPutResponse);
    const changedPullRequestRule = changedNestedParameter.rules.find(
      (rule) => rule.type === "pull_request",
    );
    if (!changedPullRequestRule?.parameters) throw new Error("missing pull-request parameters");
    changedPullRequestRule.parameters.require_code_owner_review = false;
    expect(matchesAuthorizedRulesetPayload(changedNestedParameter, authorizedPayload)).toBe(false);

    const removedRule = cloneJson(postPutResponse);
    removedRule.rules = removedRule.rules.filter((rule) => rule.type !== "deletion");
    expect(matchesAuthorizedRulesetPayload(removedRule, authorizedPayload)).toBe(false);

    const unexpectedResponseField = cloneJson(postPutResponse) as Record<string, unknown>;
    unexpectedResponseField.mutable_server_field = true;
    expect(matchesAuthorizedRulesetPayload(unexpectedResponseField, authorizedPayload)).toBe(false);
  });

  it("keeps routes fail-closed while documenting the repository-admin override", () => {
    const config = readJson<{
      enforcement: {
        claAssistantAllowlist: string[];
        maintainerOverride: boolean;
      };
      routes: Record<string, { bypass: boolean; statusRequirement: string }>;
    }>(configPath);

    expect(config.enforcement.claAssistantAllowlist).toEqual([]);
    expect(config.enforcement.maintainerOverride).toBe(true);
    for (const route of Object.values(config.routes)) {
      expect(route.bypass).toBe(false);
      expect(route.statusRequirement).toBe("required");
    }
  });

  it("maps employer and corporate authority to the same required CLA status", () => {
    const config = readJson<{
      routes: Record<
        string,
        {
          records: string[];
          statusRequirement: string;
          bypass: boolean;
        }
      >;
    }>(configPath);

    expect(config.routes.individual.records).toEqual(["individual-cla-acceptance"]);
    expect(config.routes.employer.records).toEqual([
      "individual-cla-acceptance",
      "employer-contribution-authorization",
    ]);
    expect(config.routes.corporate.records).toEqual([
      "corporate-contributor-license-agreement",
      "authorized-contributor-schedule",
    ]);
    for (const route of Object.values(config.routes)) {
      expect(route.statusRequirement).toBe("required");
      expect(route.bypass).toBe(false);
    }
  });

  it("publishes only a redacted proof schema and an operator runbook", () => {
    const schema = readJson<{
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    }>(proofSchemaPath);
    const runbook = read(runbookPath);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "repository",
        "agreement",
        "ruleset",
        "claCheck",
        "cases",
        "redaction",
      ]),
    );
    expect(schema.properties).not.toHaveProperty("signatures");
    expect(schema.properties).not.toHaveProperty("signers");
    expect(schema.properties).not.toHaveProperty("emails");
    const rulesetSchema = schema.properties.ruleset as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(rulesetSchema.required).not.toEqual(
      expect.arrayContaining(["claStatusContext", "claIntegrationId"]),
    );
    const claCheckSchema = schema.properties.claCheck as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(claCheckSchema.required).toEqual(["statusContext", "integrationId"]);
    expect(claCheckSchema.properties.integrationId).toEqual({
      type: "integer",
      minimum: 1,
    });
    const agreementSchema = schema.properties.agreement as {
      properties: Record<string, unknown>;
    };
    expect(agreementSchema.properties.sha256).toEqual({
      const: APPROVED_AGREEMENT_SHA256,
    });
    const casesSchema = schema.properties.cases as {
      minItems: number;
      maxItems: number;
      contains: unknown;
      items: { oneOf: unknown[] };
    };
    expect(casesSchema.minItems).toBe(4);
    expect(casesSchema.maxItems).toBe(4);
    expect(casesSchema.items.oneOf).toHaveLength(4);
    expect(JSON.stringify(casesSchema)).toContain("maxContains");
    expect(JSON.stringify(casesSchema.items)).not.toContain("claStatusContext");
    expect(JSON.stringify(casesSchema.items)).not.toContain("claIntegrationId");
    expect(JSON.stringify(casesSchema.items)).toContain('"pending"');
    expect(runbook).toContain("CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE");
    expect(runbook).toContain("CLA_INTEGRATION_ID_TO_OBSERVE_LIVE");
    expect(runbook).toContain("integration_id");
    expect(runbook).toContain("19995472");
    expect(runbook).toContain("unsigned");
    expect(runbook).toContain("accepted");
    expect(runbook).toContain("employer");
    expect(runbook).toContain("corporate");
    expect(runbook).toContain("redacted");
    expect(runbook).toContain("do not");
    expect(runbook).toContain("repository-admin pull-request bypass");
    expect(runbook).toContain("full replacement");
    expect(runbook).toContain("--slurpfile authorized");
    expect(runbook).toContain("source_type");
    expect(runbook).toContain("current_user_can_bypass");
    expect(runbook).toContain("ruleset.after-requery");
    expect(runbook).toContain("mktemp -d");
    expect(runbook).toContain("chmod 700");
    expect(runbook).toContain("umask 077");
    expect(runbook).toContain("trap");
    expect(runbook).not.toContain("/tmp/tendnote-");
    expect(runbook).toMatch(/canonical[\s\S]*agreement Gist[\s\S]*retain/i);
    expect(runbook).toMatch(/do not delete or unlink the canonical/i);
    expect(runbook).toContain("desired-state manifest");
  });

  it("validates the complete synthetic redacted proof fixture", () => {
    const proof = readJson<ProofFixture>(validProofPath);

    expect(validateRedactedProof(proof)).toEqual([]);
  });

  it("accepts a pending unsigned proof while keeping it open-unmergeable", () => {
    const proof = readJson<ProofFixture>(pendingProofPath);

    expect(validateRedactedProof(proof)).toEqual([]);
    expect(proof.cases.find((proofCase) => proofCase.kind === "unsigned")).toMatchObject({
      status: "pending",
      outcome: "open-unmergeable",
    });

    const contradictory = cloneJson(proof);
    const unsigned = contradictory.cases.find((proofCase) => proofCase.kind === "unsigned");
    if (!unsigned) throw new Error("pending fixture must include an unsigned case");
    unsigned.outcome = "eligible";
    expect(validateRedactedProof(contradictory)).toContain(
      "unsigned case has an unexpected status/outcome",
    );
  });

  it("rejects duplicate and contradictory proof cases in the invalid fixture", () => {
    const proof = readJson<ProofFixture>(invalidProofPath);
    const errors = validateRedactedProof(proof);

    expect(errors).toEqual(
      expect.arrayContaining([
        "proof must contain exactly one unsigned case",
        "proof must contain exactly one corporate case",
        "unsigned case has an unexpected status/outcome",
        "agreement hash does not match the approved ICLA",
      ]),
    );
  });
});
