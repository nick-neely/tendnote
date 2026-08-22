import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ORIGIN,
  composeQualificationReport,
  FORMER_ORIGIN,
  QUALIFICATION_GATES,
  validateQualificationReport,
  verifyCanonicalOrigin,
  verifyDeterministicEvidenceBundle,
} from "./publication-qualification.mjs";

const CANDIDATE = "a".repeat(40);
const EVIDENCE_DIGEST = "b".repeat(64);

function evidence() {
  return [
    {
      path: "evidence/qualification/a/report.json",
      sourceCommit: CANDIDATE,
      sha256: EVIDENCE_DIGEST,
      format: "json",
    },
  ];
}

function passingInput(overrides: Record<string, unknown> = {}) {
  const gates = Object.fromEntries(
    QUALIFICATION_GATES.map((gate) => [
      gate.id,
      {
        status: "passed",
        evidence: evidence(),
        criteria: Object.fromEntries(
          gate.criteria.map((criterion) => [criterion.id, { status: "passed" }]),
        ),
      },
    ]),
  );
  return {
    candidateSha: CANDIDATE,
    generatedAt: "2026-08-22T18:00:00.000Z",
    gates,
    ...overrides,
  };
}

describe("Phase 9a publication qualification report", () => {
  it("requires every named surface and produces a qualified exact-commit report when all pass", () => {
    const report = composeQualificationReport(passingInput());

    expect(report.result).toEqual({ status: "qualified", clean: true, blockers: [] });
    expect(report.candidate).toMatchObject({
      commit: CANDIDATE,
      immutable: true,
      visibility: "private",
    });
    expect(report.gates.map((gate) => gate.id)).toEqual(QUALIFICATION_GATES.map((gate) => gate.id));
    expect(validateQualificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("keeps owner-only governance pending instead of turning it into a warning", () => {
    const report = composeQualificationReport(
      passingInput({
        gates: {
          ...passingInput().gates,
          "live-governance": {
            status: "pending",
            reason: "PVR, CLA, and fork-PR proof require post-public owner work.",
          },
        },
      }),
    );
    const governance = report.gates.find((gate) => gate.id === "live-governance");

    expect(report.result.status).toBe("blocked");
    expect(governance?.status).toBe("pending");
    expect(report.result.blockers.some((entry) => entry.code === "pending")).toBe(true);
    expect(report.result.blockers.some((entry) => entry.gateId === "live-governance")).toBe(true);
  });

  it.each([
    "skipped",
    "recovered",
    "stale",
    "not-run",
    "failed",
  ] as const)("blocks a %s result even when every other gate passes", (status) => {
    const input = passingInput();
    input.gates = { ...input.gates, "repository-verification": { status, evidence: evidence() } };
    const report = composeQualificationReport(input);

    expect(report.result.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.id === "repository-verification")?.status).toBe(status);
  });

  it("blocks a passing gate that omits one of its listed fresh-reader criteria", () => {
    const input = passingInput();
    const reader = input.gates["reader-evidence-path"] as Record<string, unknown>;
    const criteria = { ...(reader.criteria as Record<string, unknown>) };
    delete criteria.security;
    input.gates = { ...input.gates, "reader-evidence-path": { ...reader, criteria } };
    const report = composeQualificationReport(input);

    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterionId: "security", code: "missing-criterion" }),
      ]),
    );
  });

  it("blocks stale evidence instead of allowing a prior bundle to qualify a new commit", () => {
    const input = passingInput();
    const deterministicGate = QUALIFICATION_GATES.find(
      (gate) => gate.id === "deterministic-evidence-integrity",
    );
    if (!deterministicGate) throw new Error("Deterministic gate definition is missing.");
    input.gates = {
      ...input.gates,
      "deterministic-evidence-integrity": {
        status: "passed",
        evidence: [{ ...evidence()[0], sourceCommit: "c".repeat(40) }],
        criteria: Object.fromEntries(
          deterministicGate.criteria.map((criterion) => [criterion.id, { status: "passed" }]),
        ),
      },
    };
    const report = composeQualificationReport(input);

    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "stale-source" })]),
    );
  });

  it("records publication and external-send boundaries without authorizing either mutation", () => {
    const report = composeQualificationReport(
      passingInput({
        boundary: {
          repositoryPublication: {
            status: "pending-owner-approval",
            visibilityMutationPerformed: true,
          },
          externalSends: { performed: true },
        },
      }),
    );

    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "visibility-mutated" }),
        expect.objectContaining({ code: "external-send-performed" }),
      ]),
    );
  });
});

function writeBundle(root: string, sourceCommit = CANDIDATE) {
  const bundle = join(root, "bundle");
  mkdirSync(join(bundle, "raw"), { recursive: true });
  const metadata = {
    schemaVersion: 1,
    suite: "deterministic",
    sourceCommit,
    clean: true,
    exitCode: 0,
    counts: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0 },
    statuses: { completed: 2 },
    retry: { attempted: false, rounds: 0 },
  };
  const summary = { totalEvals: 2, passed: 2, failed: 0, skipped: 0, errored: 0 };
  const files: Record<string, string> = {
    "README.md": `CLEAN\nSource commit: ${sourceCommit}\n`,
    "junit.xml": '<testsuite tests="2" failures="0" skipped="0"></testsuite>\n',
    "metadata.json": `${JSON.stringify(metadata)}\n`,
    "raw/results.jsonl":
      '{"id":"one","verdict":"passed","status":"completed"}\n{"id":"two","verdict":"passed","status":"completed"}\n',
    "raw/summary.json": `${JSON.stringify(summary)}\n`,
  };
  for (const [path, contents] of Object.entries(files)) writeFileSync(join(bundle, path), contents);
  const checksums = Object.entries(files)
    .map(([path, contents]) => `${createHash("sha256").update(contents).digest("hex")}  ${path}`)
    .join("\n");
  writeFileSync(join(bundle, "SHA256SUMS"), `${checksums}\n`);
  return bundle;
}

describe("publication evidence adapters", () => {
  it("accepts a complete clean deterministic bundle and rejects stale source", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    writeBundle(root);
    expect(
      verifyDeterministicEvidenceBundle({ root, bundlePath: "bundle", candidateSha: CANDIDATE })
        .status,
    ).toBe("passed");
    expect(
      verifyDeterministicEvidenceBundle({
        root,
        bundlePath: "bundle",
        candidateSha: "c".repeat(40),
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("blocks waiting evidence even when the counts look complete", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const bundle = writeBundle(root);
    const metadataPath = join(bundle, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.statuses = { waiting: 2 };
    writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
    const result = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/waiting/i)]));
  });

  it("verifies the canonical HTTPS origin and permanent former-origin redirect read-only", async () => {
    const result = await verifyCanonicalOrigin({
      fetchImpl: async (url) =>
        url === `${CANONICAL_ORIGIN}/`
          ? { status: 200, headers: new Headers() }
          : { status: 301, headers: new Headers({ location: `${CANONICAL_ORIGIN}/` }) },
    });

    expect(result).toMatchObject({
      status: "passed",
      checks: { canonical: { status: 200 }, former: { status: 301 } },
    });
  });

  it("rejects a temporary redirect or a non-canonical target", async () => {
    const result = await verifyCanonicalOrigin({
      formerOrigin: FORMER_ORIGIN,
      fetchImpl: async () => ({
        status: 307,
        headers: new Headers({ location: "https://example.test/" }),
      }),
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/permanent|exact canonical/i);
  });
});
