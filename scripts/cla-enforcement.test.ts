import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const agreementPath = "docs/legal/individual-contributor-license-agreement.md";
const metadataPath = "docs/legal/cla-assistant-metadata.json";
const configPath = ".github/cla-assistant.json";
const rulesetPath = ".github/rulesets/protect-main.json";
const proofSchemaPath = "docs/phase-9a/cla-gate-proof.schema.json";
const runbookPath = "docs/phase-9a/cla-enforcement-runbook.md";

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
      repository: string;
      service: { name: string; url: string };
      enforcement: {
        required: boolean;
        observeBeforeEnforce: boolean;
        statusContext: { value: string | null; placeholder: string };
        rulesetId: number;
        existingRequiredStatusContexts: string[];
        preserveExistingChecks: boolean;
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

    expect(config.repository).toBe("nick-neely/tendnote");
    expect(config.service).toEqual({ name: "CLA Assistant", url: "https://cla-assistant.io" });
    expect(config.enforcement.required).toBe(true);
    expect(config.enforcement.observeBeforeEnforce).toBe(true);
    expect(config.enforcement.statusContext).toEqual({
      value: null,
      placeholder: "CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE",
    });
    expect(config.enforcement.rulesetId).toBe(19995472);
    expect(config.enforcement.preserveExistingChecks).toBe(true);
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
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ]);
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
    expect(runbook).toContain("CLA_STATUS_CONTEXT_TO_OBSERVE_LIVE");
    expect(runbook).toContain("19995472");
    expect(runbook).toContain("unsigned");
    expect(runbook).toContain("accepted");
    expect(runbook).toContain("employer");
    expect(runbook).toContain("corporate");
    expect(runbook).toContain("redacted");
    expect(runbook).toContain("do not");
  });
});
