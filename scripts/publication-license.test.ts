import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

// These documents preserve immutable qualification evidence from earlier
// deployments. They are deliberately excluded from the current-tree scan so
// a historical record cannot be rewritten into misleading present-tense
// configuration; the separate test below requires each one to say so.
const HISTORICAL_EVIDENCE_PATHS = new Set([
  "docs/phase-9a/publication-inventory.md",
  "docs/verification/nextjs-16-3-partial-prefetching.md",
  "docs/verification/nextjs-16-3-preview-qualification.md",
  "docs/verification/phase-7-personal-os.md",
]);
// These two directories are byte-preserved upstream payloads. Their provenance
// and licenses are checked above; scanning their source text for old maintainer
// values would treat third-party history as current Tendnote configuration.
const THIRD_PARTY_PATH_PREFIXES = [".agents/skills/impeccable/", ".claude/skills/impeccable/"];

const CURRENT_TREE_MAINTAINER_PATTERNS = [
  { label: "former hosted origin", pattern: /\bstacklet\.app\b/i },
  { label: "Vercel deployment identifier", pattern: /\bdpl_[A-Za-z0-9]+\b/ },
  { label: "Vercel project identifier", pattern: /\bprj_[A-Za-z0-9]+\b/ },
  { label: "maintainer Vercel host", pattern: /\bnick-neely\.vercel\.app\b/i },
  { label: "maintainer Vercel scope", pattern: /--scope\s+nick-neely\b/i },
  { label: "maintainer RunsOn stack", pattern: /\bnick-neely\/\.github-private\b/i },
];

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(resolve(root, relativePath)))
    .digest("hex");
}

function currentTextFiles(repositoryRoot = root, trackedPaths?: string[]): string[] {
  const publishablePaths =
    trackedPaths ??
    execFileSync("git", ["ls-files", "-z"], {
      cwd: repositoryRoot,
    })
      .toString()
      .split("\0")
      .filter(Boolean);

  const files: string[] = [];
  for (const relativePath of publishablePaths) {
    if (HISTORICAL_EVIDENCE_PATHS.has(relativePath)) continue;
    // The fixture necessarily contains the forbidden patterns as regexes.
    if (relativePath.endsWith("scripts/publication-license.test.ts")) continue;
    if (THIRD_PARTY_PATH_PREFIXES.some((path) => relativePath.startsWith(path))) continue;
    if (readFileSync(resolve(repositoryRoot, relativePath)).includes(0)) continue;
    files.push(relativePath);
  }

  return files.sort();
}

function findMaintainerDeploymentLeaks(repositoryRoot = root, trackedPaths?: string[]): string[] {
  const leaks: string[] = [];

  for (const file of currentTextFiles(repositoryRoot, trackedPaths)) {
    const contents = readFileSync(resolve(repositoryRoot, file), "utf8");
    for (const { label, pattern } of CURRENT_TREE_MAINTAINER_PATTERNS) {
      if (pattern.test(contents)) leaks.push(`${label}: ${file}`);
    }
  }

  return leaks;
}

describe("fresh-clone publication gate", () => {
  it("scans tracked files while ignoring local artifacts and preserving nested coverage", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "tendnote-publication-"));
    try {
      writeFileSync(resolve(fixtureRoot, ".gitignore"), ".scratch/\n");
      mkdirSync(resolve(fixtureRoot, "docs/reference"), { recursive: true });
      writeFileSync(resolve(fixtureRoot, "docs/reference/config.md"), "canonical example\n");
      mkdirSync(resolve(fixtureRoot, ".scratch/worktrees/other"), { recursive: true });
      writeFileSync(
        resolve(fixtureRoot, ".scratch/worktrees/other/generated.md"),
        "stacklet.app should not be published\n",
      );
      const trackedPaths = [".gitignore", "docs/reference/config.md"];
      expect(findMaintainerDeploymentLeaks(fixtureRoot, trackedPaths)).toEqual([]);

      writeFileSync(
        resolve(fixtureRoot, "docs/reference/nested.md"),
        "stacklet.app must fail the publication gate\n",
      );
      trackedPaths.push("docs/reference/nested.md");
      expect(findMaintainerDeploymentLeaks(fixtureRoot, trackedPaths)).toEqual([
        "former hosted origin: docs/reference/nested.md",
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("identifies the complete outbound AGPL license", () => {
    const license = read("LICENSE");
    const packageManifest = JSON.parse(read("package.json")) as { license?: string };
    const readme = read("README.md");

    expect(packageManifest.license).toBe("AGPL-3.0-only");
    expect(license).toHaveLength(34523);
    expect(sha256("LICENSE")).toBe(
      "0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0",
    );
    expect(readme).toContain("[AGPL-3.0-only](LICENSE)");
  });

  it("records every current redistributed Impeccable variant", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");
    const apacheLicense = read("LICENSES/Apache-2.0.txt");

    expect(apacheLicense).toHaveLength(10766);
    expect(sha256("LICENSES/Apache-2.0.txt")).toBe(
      "02bb8c3b4e70190e3986c0404ad2fd8d639b4f534252d82379cc1b502b6d1812",
    );
    expect(read("LICENSES/Impeccable-NOTICE.md")).toHaveLength(503);
    expect(sha256("LICENSES/Impeccable-NOTICE.md")).toBe(
      "c60a093c2845fd9fb82f9c6f742ece31f379f8190b535309d32d66c45ccffdcb",
    );
    expect(read("LICENSES/MIT.txt")).toHaveLength(1056);
    expect(sha256("LICENSES/MIT.txt")).toBe(
      "1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685",
    );
    expect(notices).toContain("pbakaus/impeccable");
    expect(notices).toContain("skill-v4.0.2");
    expect(notices).toMatch(/Retrieved:\*\*? 2026-08-19/);
    expect(notices).toContain("Copyright 2025 Paul Bakaus");
    expect(notices).toContain("NOTICE.md");
    expect(notices).toContain("LICENSES/Impeccable-NOTICE.md");
    expect(notices).toContain("ehmo/platform-design-skills");
    expect(notices).toContain("LICENSES/MIT.txt");
    expect(notices).toContain("Original license: MIT");
    expect(notices).toContain(".agents/skills/impeccable/");
    expect(notices).toContain(".claude/skills/impeccable/");
    for (const path of [
      ".agents/skills/impeccable/reference/ios.md",
      ".agents/skills/impeccable/reference/android.md",
      ".claude/skills/impeccable/reference/ios.md",
      ".claude/skills/impeccable/reference/android.md",
    ]) {
      expect(notices).toContain(path);
    }
    for (const variant of [".agents/skills/impeccable/", ".claude/skills/impeccable/"]) {
      expect(existsSync(resolve(root, variant, "SKILL.md"))).toBe(true);
      expect(read(`${variant}SKILL.md`)).toContain("version: 4.0.2");
    }
  });

  it("publishes the repeatable gate for future third-party bundles", () => {
    const gate = read("docs/agents/third-party-bundles.md");

    expect(gate).toContain("source");
    expect(gate).toContain("immutable release");
    expect(gate).toContain("compatibility");
    expect(gate).toContain("NOTICE");
    expect(gate).toMatch(/exact tracked paths/i);
    expect(gate).toContain("pnpm publication:check");
    expect(gate).toContain("not legal advice");
  });

  it("keeps the current tree free of maintainer deployment values", () => {
    expect(findMaintainerDeploymentLeaks()).toEqual([]);
    const currentConfig = [
      "apps/web/.env.example",
      "apps/agent/.env.example",
      "docs/email-setup.md",
    ]
      .map(read)
      .join("\n");
    expect(currentConfig).toContain("BETTER_AUTH_URL");
    expect(currentConfig).toContain("<BETTER_AUTH_URL>");
    expect(currentConfig).toContain("example.com");
  });

  it("keeps the email setup path explicit about its Cloudflare prerequisite", () => {
    const emailSetup = read("docs/email-setup.md");
    const localDevelopment = read("docs/local-development.md");

    expect(emailSetup).toMatch(/assumes Cloudflare DNS/i);
    expect(emailSetup).toContain("Cloudflare dashboard");
    expect(emailSetup).toMatch(/DNS only.*grey cloud/);
    expect(emailSetup).toMatch(
      /Locally, with a real send:[\s\S]*RESEND_API_KEY=re_[^\n]*[\s\S]*TENDNOTE_EMAIL_FROM=[^\n]*[\s\S]*TENDNOTE_EMAIL_REPLY_TO=[^\n]*/,
    );
    expect(localDevelopment).toMatch(
      /Setting `RESEND_API_KEY`, `TENDNOTE_EMAIL_FROM`, and an explicit `TENDNOTE_EMAIL_REPLY_TO` turns real sending on/,
    );
  });

  it("labels deployment records as historical evidence rather than configuration", () => {
    for (const file of [
      "docs/phase-9a/publication-inventory.md",
      "docs/verification/nextjs-16-3-partial-prefetching.md",
      "docs/verification/nextjs-16-3-preview-qualification.md",
      "docs/verification/phase-7-personal-os.md",
    ]) {
      expect(read(file)).toContain("Historical qualification evidence");
    }
  });
});
