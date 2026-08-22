import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ORIGIN,
  composeQualificationReport,
  FORMER_ORIGIN,
  QUALIFICATION_BINDINGS,
  QUALIFICATION_GATES,
  validateQualificationReport,
  verifyCanonicalOrigin,
  verifyDeterministicEvidenceBundle,
  verifyEvidenceFiles,
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
          gate.criteria.map((criterion) => [
            criterion.id,
            {
              status: "passed",
              evidence: evidence(),
              ...(QUALIFICATION_BINDINGS[criterion.id]
                ? { binding: QUALIFICATION_BINDINGS[criterion.id] }
                : {}),
            },
          ]),
        ),
      },
    ]),
  );
  return {
    candidateSha: CANDIDATE,
    generatedAt: "2026-08-22T18:00:00.000Z",
    gates,
    boundary: {
      repositoryPublication: {
        status: "approved",
        visibilityMutationPerformed: false,
      },
      externalSends: { status: "none", performed: false },
    },
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

  it("rejects conflicting candidate SHAs and duplicate or unknown IDs", () => {
    const input = passingInput({
      candidate: { commit: "c".repeat(40) },
      gates: [
        { id: "repository-readiness", status: "passed" },
        { id: "repository-readiness", status: "passed" },
        { id: "unknown-gate", status: "passed" },
      ],
    });
    const report = composeQualificationReport(input);

    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "conflicting-candidate" }),
        expect.objectContaining({ code: "duplicate-gate" }),
        expect.objectContaining({ code: "unknown-gate" }),
      ]),
    );

    const criteria = [
      { id: "license", status: "passed", evidence: evidence() },
      { id: "license", status: "passed", evidence: evidence() },
      { id: "unknown", status: "passed", evidence: evidence() },
    ];
    const criteriaReport = composeQualificationReport(
      passingInput({
        gates: {
          ...passingInput().gates,
          "repository-readiness": { status: "passed", criteria },
        },
      }),
    );
    expect(criteriaReport.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-criterion" }),
        expect.objectContaining({ code: "unknown-criterion" }),
      ]),
    );
  });

  it("requires explicit machine bindings and criterion evidence for owner gates", () => {
    const input = passingInput();
    const governance = input.gates["live-governance"] as Record<string, unknown>;
    const criteria = { ...(governance.criteria as Record<string, Record<string, unknown>>) };
    delete criteria["repository-publication-approval"].binding;
    delete criteria["repository-publication-approval"].evidence;
    input.gates = { ...input.gates, "live-governance": { ...governance, criteria } };
    const report = composeQualificationReport(input);

    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-or-invalid-binding" }),
        expect.objectContaining({ code: "missing-evidence" }),
      ]),
    );
  });

  it.each([
    undefined,
    {},
    {
      repositoryPublication: {
        status: "approved",
        visibilityMutationPerformed: "false",
      },
      externalSends: { status: "none", performed: false },
    },
    {
      repositoryPublication: {
        status: "pending-owner-approval",
        visibilityMutationPerformed: false,
      },
      externalSends: { status: "none", performed: false },
    },
  ])("blocks missing, pending, or malformed boundary state %#", (boundary) => {
    const report = composeQualificationReport(passingInput({ boundary }));
    expect(report.result.status).toBe("blocked");
    expect(report.result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/boundary|pending-owner-approval/),
        }),
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
    workflow: {
      trigger: "workflow_dispatch",
      url: "https://github.com/nick-neely/tendnote/actions/runs/1",
      command: "pnpm --filter @tendnote/agent eval:deterministic",
    },
    configuration: {
      agentModel: "google/gemini-3.7-flash",
      eveVersion: "0.32.0",
      database: "fresh synthetic database",
    },
    timestamps: {
      startedAt: "2026-08-22T17:00:00.000Z",
      completedAt: "2026-08-22T17:05:00.000Z",
      packagedAt: "2026-08-22T17:06:00.000Z",
    },
    evalIds: ["one", "two"],
    clean: true,
    exitCode: 0,
    counts: { total: 2, passed: 2, failed: 0, skipped: 0, errored: 0 },
    statuses: { completed: 2 },
    retry: { attempted: false, rounds: 0 },
  };
  const summary = {
    startedAt: "2026-08-22T17:00:00.000Z",
    completedAt: "2026-08-22T17:05:00.000Z",
    totalEvals: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    errored: 0,
    evals: [
      { id: "one", result: { status: "completed" } },
      { id: "two", result: { status: "completed" } },
    ],
  };
  const files: Record<string, string> = {
    "README.md": `CLEAN\n| Source commit | \`${sourceCommit}\` |\n`,
    "junit.xml":
      '<testsuite tests="2" failures="0" skipped="0"><testcase name="one"/><testcase name="two"/></testsuite>\n',
    "metadata.json": `${JSON.stringify(metadata)}\n`,
    "raw/initial-results.jsonl":
      '{"id":"one","verdict":"passed","status":"completed"}\n{"id":"two","verdict":"passed","status":"completed"}\n',
    "raw/initial-summary.json": `${JSON.stringify(summary)}\n`,
  };
  for (const [path, contents] of Object.entries(files)) writeFileSync(join(bundle, path), contents);
  const checksums = Object.entries(files)
    .map(([path, contents]) => `${createHash("sha256").update(contents).digest("hex")}  ${path}`)
    .join("\n");
  writeFileSync(join(bundle, "SHA256SUMS"), `${checksums}\n`);
  return bundle;
}

describe("publication evidence adapters", () => {
  it("accepts the canonical packager-shaped clean bundle and rejects stale source", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    writeBundle(root);
    const clean = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });
    expect(clean.status).toBe("passed");
    expect(clean.evidence.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "bundle/raw/initial-results.jsonl",
        "bundle/raw/initial-summary.json",
      ]),
    );
    expect(
      verifyDeterministicEvidenceBundle({
        root,
        bundlePath: "bundle",
        candidateSha: "c".repeat(40),
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("rejects legacy raw names, retry artifacts, and non-completed statuses", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const bundle = writeBundle(root);
    writeFileSync(join(bundle, "raw", "retry-1-results.jsonl"), "retry\n");
    const result = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/retry artifact/i);

    const legacyRoot = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const legacyBundle = writeBundle(legacyRoot);
    const initial = readFileSync(join(legacyBundle, "raw", "initial-results.jsonl"), "utf8");
    writeFileSync(join(legacyBundle, "raw", "results.jsonl"), initial);
    expect(
      verifyDeterministicEvidenceBundle({
        root: legacyRoot,
        bundlePath: "bundle",
        candidateSha: CANDIDATE,
      }).status,
    ).toBe("blocked");

    const waitingRoot = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const waitingBundle = writeBundle(waitingRoot);
    const rowsPath = join(waitingBundle, "raw", "initial-results.jsonl");
    writeFileSync(rowsPath, initial.replaceAll('"completed"', '"waiting"'));
    expect(
      verifyDeterministicEvidenceBundle({
        root: waitingRoot,
        bundlePath: "bundle",
        candidateSha: CANDIDATE,
      }).status,
    ).toBe("blocked");
  });

  it("rejects duplicate or missing eval IDs across metadata, summary, and JSONL", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const bundle = writeBundle(root);
    const metadataPath = join(bundle, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.evalIds = ["one", "one"];
    writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
    expect(
      verifyDeterministicEvidenceBundle({
        root,
        bundlePath: "bundle",
        candidateSha: CANDIDATE,
      }).blockers.join(" "),
    ).toMatch(/evalIds|ID sets/i);

    const summaryPath = join(bundle, "raw", "initial-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.evals[1].id = "one";
    writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
    expect(
      verifyDeterministicEvidenceBundle({
        root,
        bundlePath: "bundle",
        candidateSha: CANDIDATE,
      }).blockers.join(" "),
    ).toMatch(/raw summary eval IDs|ID sets/i);

    const rowsPath = join(bundle, "raw", "initial-results.jsonl");
    writeFileSync(
      rowsPath,
      '{"id":"one","verdict":"passed","status":"completed"}\n{"id":"one","verdict":"passed","status":"completed"}\n',
    );
    expect(
      verifyDeterministicEvidenceBundle({
        root,
        bundlePath: "bundle",
        candidateSha: CANDIDATE,
      }).blockers.join(" "),
    ).toMatch(/JSONL duplicates|ID sets/i);
  });

  it("structurally rejects multiple suites and inconsistent outcome elements", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const bundle = writeBundle(root);
    const junitPath = join(bundle, "junit.xml");
    writeFileSync(
      junitPath,
      '<testsuite tests="1" failures="0" skipped="0"><testcase name="one"><failure/></testcase></testsuite><testsuite tests="0" failures="0" skipped="0"></testsuite>\n',
    );
    let result = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/exactly one testsuite/i);

    writeFileSync(
      junitPath,
      '<testsuite tests="2" failures="0" skipped="0"><testcase name="one"><failure/></testcase><testcase name="two"/></testsuite>\n',
    );
    result = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/aggregate counts|counts disagree/i);

    writeFileSync(
      junitPath,
      '<testsuite tests="2" failures="0" skipped="0"><testcase name="one"><error/></testcase><testcase name="two"><skipped/></testcase></testsuite>\n',
    );
    result = verifyDeterministicEvidenceBundle({
      root,
      bundlePath: "bundle",
      candidateSha: CANDIDATE,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/aggregate counts|counts disagree/i);
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

  it("requires a complete raw summary object and exact JUnit agreement", () => {
    const root = mkdtempSync(join("/tmp", "tendnote-qualification-"));
    const bundle = writeBundle(root);
    const summaryPath = join(bundle, "raw", "initial-summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    delete summary.errored;
    writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`);
    expect(
      verifyDeterministicEvidenceBundle({ root, bundlePath: "bundle", candidateSha: CANDIDATE })
        .status,
    ).toBe("blocked");

    const junitPath = join(bundle, "junit.xml");
    writeFileSync(junitPath, '<testsuite tests="2" failures="1" skipped="0"></testsuite>\n');
    expect(
      verifyDeterministicEvidenceBundle({ root, bundlePath: "bundle", candidateSha: CANDIDATE })
        .status,
    ).toBe("blocked");
  });

  it("reads tracked evidence from the candidate blob, not the working tree", () => {
    const root = process.cwd();
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const bytes = execFileSync("git", ["show", `${candidateSha}:package.json`], {
      cwd: root,
      encoding: null,
    });
    const result = verifyEvidenceFiles({
      root,
      candidateSha,
      evidence: [
        {
          path: "package.json",
          sourceCommit: candidateSha,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });
    expect(result).toEqual({ status: "passed", blockers: [] });
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

  it("creates nested CLI output and keeps the default report blocked", () => {
    const root = process.cwd();
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const outputRoot = join(root, "evidence", "qualification", `focused-${process.pid}`);
    const output = join(outputRoot, "nested", "report.json");
    const outputArgument = relative(root, output);
    try {
      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/publication-qualification.mjs"),
          "--candidate-sha",
          candidateSha,
          "--output",
          outputArgument,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report.result.status).toBe("blocked");
      expect(report.result.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "boundary-missing" })]),
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects outside and symlinked output locations before writing", () => {
    const root = process.cwd();
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const outside = join("/tmp", `tendnote-qualification-outside-${process.pid}`, "report.json");
    const outputRoot = join(root, "evidence", "qualification", `symlink-${process.pid}`);
    const link = join(outputRoot, "link");
    mkdirSync(outputRoot, { recursive: true });
    symlinkSync("/tmp", link);
    try {
      const outsideResult = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/publication-qualification.mjs"),
          "--candidate-sha",
          candidateSha,
          "--output",
          outside,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(outsideResult.status).toBe(1);
      expect(outsideResult.stderr).toMatch(/under evidence\/qualification|relative/i);

      const symlinkResult = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/publication-qualification.mjs"),
          "--candidate-sha",
          candidateSha,
          "--output",
          `evidence/qualification/symlink-${process.pid}/link/report.json`,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(symlinkResult.status).toBe(1);
      expect(symlinkResult.stderr).toMatch(/symlink/i);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("keeps schema-parity failures visible instead of trusting shape claims", () => {
    const report = composeQualificationReport(passingInput());
    const invalid = structuredClone(report) as Record<string, unknown>;
    invalid.candidate = {
      ...(invalid.candidate as object),
      immutable: false,
      visibility: "secret",
    };
    invalid.result = { ...(invalid.result as object), clean: false };
    (invalid as Record<string, unknown>).unexpected = true;
    expect(validateQualificationReport(invalid).valid).toBe(false);
  });

  it("requires passed criteria and gates to carry consistent zero-blocker state", () => {
    const report = composeQualificationReport(passingInput());
    const invalidCriterion = structuredClone(report);
    invalidCriterion.gates[0].criteria[0].blockers = [
      {
        gateId: invalidCriterion.gates[0].id,
        criterionId: "license",
        code: "unexpected",
        message: "no",
      },
    ];
    expect(validateQualificationReport(invalidCriterion).valid).toBe(false);

    const invalidGate = structuredClone(report);
    invalidGate.gates[0].status = "blocked";
    invalidGate.gates[0].blockers = [
      { gateId: invalidGate.gates[0].id, code: "blocked", message: "blocked" },
    ];
    expect(validateQualificationReport(invalidGate).valid).toBe(false);
  });
});
