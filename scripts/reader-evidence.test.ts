import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repository = "https://github.com/nick-neely/tendnote";
const reviewedBundleCommit = "00b2edcb11be862f747a96851eb66b71dcaefd7f";
const evaluationCommit = "0031e09bd92b1ce51d2f5235a0d10172aa1da8c8";
const caseStudyPath = "docs/case-studies/tendnote-agent-built-privacy.md";
const adr0230Path =
  "docs/adr/0230-case-study-keeps-evidence-canonical-and-presentation-separate.md";
const adr0228Path = "docs/adr/0228-publication-precedes-commercialization.md";
const adr0234Path = "docs/adr/0234-reader-evidence-path-starts-at-the-readme.md";
const evidencePath = "evidence/evals/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8";
const evidenceMetadataPath = `${evidencePath}/metadata.json`;
const evidenceChecksumsPath = `${evidencePath}/SHA256SUMS`;

const reviewedBundleUrls = {
  caseStudy: `${repository}/blob/${reviewedBundleCommit}/${caseStudyPath}`,
  adr0230: `${repository}/blob/${reviewedBundleCommit}/${adr0230Path}`,
  adr0228: `${repository}/blob/${reviewedBundleCommit}/${adr0228Path}`,
  adr0234: `${repository}/blob/${reviewedBundleCommit}/${adr0234Path}`,
  evidenceTree: `${repository}/tree/${reviewedBundleCommit}/${evidencePath}`,
  evidenceReadme: `${repository}/blob/${reviewedBundleCommit}/${evidencePath}/README.md`,
  evaluationSource: `${repository}/commit/${evaluationCommit}`,
  history: `${repository}/commit/${reviewedBundleCommit}`,
};

const readerFiles = ["README.md", "docs/README.md", caseStudyPath, adr0230Path, adr0234Path];

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function gitShow(commit: string, relativePath: string): string {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
    encoding: "utf8",
  });
}

function gitBytes(commit: string, relativePath: string): Buffer {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
  });
}

function resolvedCommit(commit: string): string {
  return execFileSync("git", ["rev-parse", `${commit}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function localLinks(relativePath: string): string[] {
  return [...read(relativePath).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:https?:|mailto:|\/)/i.test(target));
}

function assertLocalLinksResolve(relativePath: string): void {
  for (const target of localLinks(relativePath)) {
    const [path] = target.split("#", 2);
    if (!path) continue;
    expect(
      existsSync(resolve(root, relativePath, "..", path)),
      `${relativePath} -> ${target}`,
    ).toBe(true);
  }
}

function githubLinks(contents: string): string[] {
  return [...contents.matchAll(/https:\/\/github\.com\/[^)\s]+/g)].map((match) => match[0]);
}

describe("reader evidence path", () => {
  it("keeps the newcomer path explicit and out of planning material", () => {
    const readme = read("README.md");
    const docs = read("docs/README.md");

    expect(readme).toContain(reviewedBundleUrls.caseStudy);
    expect(readme).toContain("technical reader path");
    expect(readme).not.toContain("docs/prd.md");
    expect(readme).not.toContain("docs/phase-9a");
    expect(docs).toContain(reviewedBundleUrls.caseStudy);
    expect(docs).toContain("adr/README.md");
    expect(docs).not.toContain("phase-9a/README.md");

    for (const path of [...readerFiles, "docs/adr/README.md"]) {
      assertLocalLinksResolve(path);
    }
  });

  it("keeps the claim, limits, and gate status beside exact evidence", () => {
    const caseStudy = read(caseStudyPath);

    expect(caseStudy).toMatch(/agent-built[\s\S]*privacy-sensitive design invariants/i);
    expect(caseStudy).toMatch(/not a[\s\S]+security audit/i);
    expect(caseStudy).toMatch(/roughly 15% of the code/i);
    expect(caseStudy).toMatch(/first Phase 9a evaluation/i);
    expect(caseStudy).toMatch(/not been exercised with a second person/i);
    expect(caseStudy).toMatch(/not a blanket correctness claim/i);
    expect(caseStudy).toMatch(/52 passed[\s\S]*8 failed[\s\S]*0 skipped[\s\S]*0[\s\S]*errored/i);
    expect(caseStudy).toMatch(
      /exploratory evidence,[\s\S]*not clean deterministic[\s\S]*qualification/i,
    );
    expect(caseStudy).toContain("#488");
    expect(caseStudy).toMatch(/not an exact qualified integration or[\s\S]*publication commit/i);
    expect(caseStudy).not.toMatch(/Publication Companion/i);
    expect(caseStudy).not.toMatch(/pricing|signup path|Phase 9b/i);

    for (const path of [adr0230Path, adr0234Path, caseStudyPath, "docs/README.md", "README.md"]) {
      expect(read(path)).not.toMatch(/roughly 30 percent|roughly 30%|read.*30 percent/i);
    }
  });

  it("pins the primary path to exact repository, commit, and file pairs", () => {
    const contents = readerFiles.map(read).join("\n");
    const expectedLinks = Object.values(reviewedBundleUrls);

    for (const link of expectedLinks) {
      expect(contents).toContain(link);
    }

    const links = githubLinks(contents);
    const allowedLinks = new Set([...expectedLinks, `${repository}/issues/488`]);
    expect(links.every((link) => allowedLinks.has(link))).toBe(true);
    expect(contents).not.toContain("369f2fe75926c20e42f9c1d47997e6cd373c3c12");

    const immutableContentLinks = links.filter((link) => !link.endsWith("/issues/488"));
    expect(
      immutableContentLinks.every((link) =>
        new RegExp(`^${repository}/(?:blob|tree|commit)/[0-9a-f]{40}(?:/|$)`).test(link),
      ),
    ).toBe(true);
  });

  it("verifies the reviewed bundle is a real local Git object with revised content", () => {
    expect(reviewedBundleCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(resolvedCommit(reviewedBundleCommit)).toBe(reviewedBundleCommit);
    expect(resolvedCommit(evaluationCommit)).toBe(evaluationCommit);

    const reviewedCaseStudy = gitShow(reviewedBundleCommit, caseStudyPath);
    const reviewedAdr = gitShow(reviewedBundleCommit, adr0230Path);
    const reviewedReaderPath = gitShow(reviewedBundleCommit, adr0234Path);
    const checksums = gitShow(reviewedBundleCommit, evidenceChecksumsPath);
    const metadata = JSON.parse(gitShow(reviewedBundleCommit, evidenceMetadataPath)) as {
      configuration: { agentModel: string; judgeModel: string | null };
      counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        errored: number;
      };
      sourceCommit: string;
      exitCode: number;
      clean: boolean;
      retry: { attempted: boolean; rounds: number };
      qualificationClaim: string;
    };

    expect(reviewedCaseStudy).toContain("roughly 15% of the code");
    expect(reviewedCaseStudy).toContain("#488");
    expect(reviewedCaseStudy).not.toMatch(/Publication Companion/i);
    expect(reviewedCaseStudy).not.toContain("369f2fe75926c20e42f9c1d47997e6cd373c3c12");
    expect(reviewedCaseStudy).not.toMatch(/roughly 30 percent|roughly 30%/i);
    expect(reviewedAdr).toContain("roughly 15 percent of the code");
    expect(reviewedAdr).not.toMatch(/Publication Companion/i);
    expect(reviewedAdr).not.toContain("369f2fe75926c20e42f9c1d47997e6cd373c3c12");
    expect(reviewedReaderPath).toContain("#488");
    expect(reviewedReaderPath).not.toMatch(/Publication Companion/i);
    expect(reviewedReaderPath).not.toContain("369f2fe75926c20e42f9c1d47997e6cd373c3c12");
    expect(metadata).toMatchObject({
      sourceCommit: evaluationCommit,
      configuration: {
        agentModel: "google/gemini-3.7-flash",
        judgeModel: null,
      },
      counts: {
        total: 60,
        passed: 52,
        failed: 8,
        skipped: 0,
        errored: 0,
      },
      exitCode: 1,
      clean: false,
      retry: { attempted: false, rounds: 0 },
      qualificationClaim:
        "accepted exploratory evidence; not a clean 60/60 deterministic qualification",
    });

    const checksumEntries = checksums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/, 2));
    expect(checksumEntries).toHaveLength(5);
    for (const [expected, relativePath] of checksumEntries) {
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
      expect(
        createHash("sha256")
          .update(gitBytes(reviewedBundleCommit, `${evidencePath}/${relativePath}`))
          .digest("hex"),
      ).toBe(expected);
    }
  });
});
