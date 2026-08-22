import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const candidateCommit = "369f2fe75926c20e42f9c1d47997e6cd373c3c12";
const evaluationCommit = "0031e09bd92b1ce51d2f5235a0d10172aa1da8c8";
const caseStudyPath = "docs/case-studies/tendnote-agent-built-privacy.md";
const evidencePath = "evidence/evals/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8";

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
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

describe("reader evidence path", () => {
  it("keeps the newcomer path explicit and out of planning material", () => {
    const readme = read("README.md");
    const docs = read("docs/README.md");

    expect(readme).toContain("docs/case-studies/tendnote-agent-built-privacy.md");
    expect(readme).toContain("technical reader path");
    expect(readme).not.toContain("docs/prd.md");
    expect(readme).not.toContain("docs/phase-9a");
    expect(docs).toContain("case-studies/tendnote-agent-built-privacy.md");
    expect(docs).toContain("adr/README.md");
    expect(docs).not.toContain("phase-9a/README.md");

    for (const path of [
      "README.md",
      "docs/README.md",
      caseStudyPath,
      "docs/adr/README.md",
      "docs/adr/0230-case-study-keeps-evidence-canonical-and-presentation-separate.md",
      "docs/adr/0234-reader-evidence-path-starts-at-the-readme.md",
    ]) {
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
    expect(caseStudy).toContain(evidencePath);
    expect(caseStudy).toContain(candidateCommit);
    expect(caseStudy).toContain(evaluationCommit);
    expect(caseStudy).not.toMatch(/Publication Companion/i);
    expect(caseStudy).not.toMatch(/pricing|signup path|Phase 9b/i);
  });

  it("uses full immutable commit anchors for evidence and decisions", () => {
    const caseStudy = read(caseStudyPath);
    const immutableLinks = [...caseStudy.matchAll(/https:\/\/github\.com\/[^)\s]+/g)].map(
      (match) => match[0],
    );

    expect(immutableLinks.length).toBeGreaterThanOrEqual(6);
    expect(
      immutableLinks.every((link) => /\/(?:blob|tree|commit)\/[0-9a-f]{40}(?:\/|$)/i.test(link)),
    ).toBe(true);
    expect(caseStudy).not.toMatch(
      /github\.com\/[^/]+\/[^/]+\/(?:tree|blob)\/(?:main|master|program\/)/i,
    );
    expect(createHash("sha1").update(candidateCommit).digest("hex")).toHaveLength(40);
  });

  it("does not leave the superseded author-read disclosure in reader-facing records", () => {
    for (const path of [
      "docs/adr/0230-case-study-keeps-evidence-canonical-and-presentation-separate.md",
      "docs/adr/0234-reader-evidence-path-starts-at-the-readme.md",
      caseStudyPath,
      "docs/README.md",
      "README.md",
    ]) {
      expect(read(path)).not.toMatch(/roughly 30 percent|roughly 30%|read.*30 percent/i);
    }
  });
});
