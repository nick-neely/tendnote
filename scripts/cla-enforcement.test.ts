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
  status: "failure" | "success";
  outcome: "open-unmergeable" | "eligible";
  observedAt: string;
  claStatusContext: string;
  claIntegrationId: number;
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
    claStatusContext: string;
    claIntegrationId: number;
  };
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

function validateRedactedProof(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["proof must be an object"];

  const proof = value as Partial<ProofFixture>;
  const requiredTopLevel = [
    "schemaVersion",
    "repository",
    "commit",
    "agreement",
    "ruleset",
    "cases",
    "redaction",
  ];
  for (const key of requiredTopLevel) {
    if (!(key in proof)) errors.push(`missing top-level field: ${key}`);
  }
  for (const key of Object.keys(proof)) {
    if (!requiredTopLevel.includes(key)) errors.push(`unexpected top-level field: ${key}`);
  }

  if (proof.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (proof.repository !== "nick-neely/tendnote") errors.push("repository is not Tendnote");
  if (typeof proof.commit !== "string" || !/^[0-9a-f]{40}$/.test(proof.commit)) {
    errors.push("commit must be a lowercase 40-character SHA");
  }
  if (!isRecord(proof.agreement)) {
    errors.push("agreement must be an object");
  } else {
    if (proof.agreement.version !== "1.0") errors.push("agreement version must be 1.0");
    if (proof.agreement.sha256 !== APPROVED_AGREEMENT_SHA256) {
      errors.push("agreement hash does not match the approved ICLA");
    }
  }

  const ruleset = proof.ruleset;
  if (!isRecord(ruleset)) {
    errors.push("ruleset must be an object");
  } else {
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
    if (
      typeof ruleset.claStatusContext !== "string" ||
      !/^\S(?:.*\S)?$/.test(ruleset.claStatusContext) ||
      ruleset.claStatusContext === "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE"
    ) {
      errors.push("ruleset CLA status context must be observed");
    }
    if (
      typeof ruleset.claIntegrationId !== "number" ||
      !Number.isInteger(ruleset.claIntegrationId) ||
      ruleset.claIntegrationId < 1
    ) {
      errors.push("ruleset CLA integration_id must be a positive integer");
    }
  }

  const cases = proof.cases;
  if (!Array.isArray(cases) || cases.length !== 4) {
    errors.push("proof must contain exactly four cases");
  } else {
    const kinds = cases.map((proofCase) => (isRecord(proofCase) ? proofCase.kind : undefined));
    for (const kind of ["unsigned", "accepted", "employer", "corporate"] as const) {
      if (kinds.filter((candidate) => candidate === kind).length !== 1) {
        errors.push(`proof must contain exactly one ${kind} case`);
      }
    }

    const expected: Record<
      ProofCase["kind"],
      { status: ProofCase["status"]; outcome: ProofCase["outcome"] }
    > = {
      unsigned: { status: "failure", outcome: "open-unmergeable" },
      accepted: { status: "success", outcome: "eligible" },
      employer: { status: "success", outcome: "eligible" },
      corporate: { status: "success", outcome: "eligible" },
    };
    for (const [index, proofCase] of cases.entries()) {
      if (!isRecord(proofCase)) {
        errors.push(`case ${index} must be an object`);
        continue;
      }
      const kind = proofCase.kind as ProofCase["kind"];
      const expectedCase = expected[kind];
      if (!expectedCase) {
        errors.push(`case ${index} has an unknown kind`);
        continue;
      }
      if (proofCase.status !== expectedCase.status || proofCase.outcome !== expectedCase.outcome) {
        errors.push(`${kind} case has an unexpected status/outcome`);
      }
      if (
        typeof proofCase.proofId !== "string" ||
        !/^redacted-[a-z0-9-]+$/.test(proofCase.proofId)
      ) {
        errors.push(`${kind} case proofId must be redacted`);
      }
      if (proofCase.identity !== "redacted") errors.push(`${kind} case identity must be redacted`);
      if (proofCase.claStatusContext !== ruleset?.claStatusContext) {
        errors.push(`${kind} case does not correlate to the ruleset status context`);
      }
      if (proofCase.claIntegrationId !== ruleset?.claIntegrationId) {
        errors.push(`${kind} case does not correlate to the ruleset integration_id`);
      }
    }
  }

  if (!isRecord(proof.redaction)) {
    errors.push("redaction must be an object");
  } else {
    for (const key of [
      "identities",
      "contactDetails",
      "acceptanceRecords",
      "temporaryPullRequests",
      "gistReferences",
    ]) {
      if (proof.redaction[key] !== true) errors.push(`redaction.${key} must be true`);
    }
  }

  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["signature", "signer", "email", "account_id", "gist_url"]) {
    if (serialized.includes(forbidden)) errors.push(`proof contains forbidden ${forbidden} data`);
  }
  return errors;
}

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
      value: null,
      placeholder: "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE",
      integrationId: null,
      integrationIdPlaceholder: "CLA_INTEGRATION_ID_TO_OBSERVE_LIVE",
    });
    expect(config.enforcement.rulesetId).toBe(19995472);
    expect(config.enforcement.preserveExistingChecks).toBe(true);
    expect(config.enforcement.removeExistingBypassActors).toBe(true);
    expect(config.enforcement.desiredBypassActors).toEqual([]);
    expect(config.enforcement.requiresPostUpdateVerification).toBe(true);
    expect(config.enforcement.existingRequiredStatusContexts).toEqual([
      "Verify",
      "Full CI qualification",
      "Vercel",
    ]);
    expect(statusRule?.parameters?.required_status_checks?.map(({ context }) => context)).toEqual([
      "Verify",
      "Full CI qualification",
      "Vercel",
    ]);
    expect(statusRule?.parameters?.required_status_checks).not.toContainEqual({
      context: "CLA Assistant",
    });
    expect(ruleset.bypass_actors).toEqual([]);
  });

  it("does not define a CLA allowlist or undocumented bypass", () => {
    const config = readJson<{
      enforcement: {
        claAssistantAllowlist: string[];
        maintainerOverride: boolean;
      };
      routes: Record<string, { bypass: boolean; statusRequirement: string }>;
    }>(configPath);

    expect(config.enforcement.claAssistantAllowlist).toEqual([]);
    expect(config.enforcement.maintainerOverride).toBe(false);
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
    expect(rulesetSchema.required).toEqual(
      expect.arrayContaining(["claStatusContext", "claIntegrationId"]),
    );
    expect(rulesetSchema.properties.claIntegrationId).toEqual({
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
    expect(runbook).toContain("bypass_actors = []");
    expect(runbook).toContain("full replacement");
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

  it("rejects duplicate and mis-correlated proof cases in the invalid fixture", () => {
    const proof = readJson<ProofFixture>(invalidProofPath);
    const errors = validateRedactedProof(proof);

    expect(errors).toEqual(
      expect.arrayContaining([
        "proof must contain exactly one unsigned case",
        "proof must contain exactly one corporate case",
        "unsigned case has an unexpected status/outcome",
        "accepted case does not correlate to the ruleset integration_id",
        "agreement hash does not match the approved ICLA",
      ]),
    );
  });
});
