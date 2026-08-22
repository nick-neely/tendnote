import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectAllMatch } from "./text-expectations";

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
const CONTRIBUTION_MARKDOWN_ENTRY_POINTS = [
  "README.md",
  "CONTRIBUTING.md",
  ".github/pull_request_template.md",
  "docs/contributing.md",
  "docs/support.md",
  "docs/local-development.md",
  "docs/ci-contributing.md",
  "docs/legal/README.md",
  "docs/legal/individual-contributor-license-agreement.md",
  "docs/legal/employer-contribution-authorization.md",
  "docs/legal/corporate-contributor-license-agreement.md",
  "docs/phase-9a/cla-enforcement-runbook.md",
] as const;

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

function currentTextFiles(repositoryRoot = root): string[] {
  const publishablePaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
  })
    .toString()
    .split("\0")
    .filter(Boolean);

  const files: string[] = [];
  for (const relativePath of publishablePaths) {
    if (HISTORICAL_EVIDENCE_PATHS.has(relativePath)) continue;
    // A renamed/deleted tracked path may still appear in an intentionally
    // dirty worktree before the replacement has been staged.
    if (!existsSync(resolve(repositoryRoot, relativePath))) continue;
    // The fixture necessarily contains the forbidden patterns as regexes.
    if (relativePath.endsWith("scripts/publication-license.test.ts")) continue;
    if (THIRD_PARTY_PATH_PREFIXES.some((path) => relativePath.startsWith(path))) continue;
    if (readFileSync(resolve(repositoryRoot, relativePath)).includes(0)) continue;
    files.push(relativePath);
  }

  return files.sort();
}

function findMaintainerDeploymentLeaks(repositoryRoot = root): string[] {
  const leaks: string[] = [];

  for (const file of currentTextFiles(repositoryRoot)) {
    const contents = readFileSync(resolve(repositoryRoot, file), "utf8");
    for (const { label, pattern } of CURRENT_TREE_MAINTAINER_PATTERNS) {
      if (pattern.test(contents)) leaks.push(`${label}: ${file}`);
    }
  }

  return leaks;
}

type LocalMarkdownLink = {
  path: string | null;
  anchor: string | null;
};

function localMarkdownLinks(relativePath: string): LocalMarkdownLink[] {
  return [...read(relativePath).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:https?:|mailto:|\/)/i.test(target))
    .map((target) => {
      const [path, anchor] = target.split("#", 2);
      return {
        path: path || null,
        anchor: anchor ? anchor.toLowerCase() : null,
      };
    });
}

function markdownAnchorIds(relativePath: string): Set<string> {
  const counts = new Map<string, number>();
  const ids = new Set<string>();

  for (const line of read(relativePath).split(/\r?\n/)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (!heading) continue;

    const slug = heading
      .replace(/<[^>]+>/g, "")
      .replace(/[\\`*_~]/g, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!slug) continue;

    const occurrence = counts.get(slug) ?? 0;
    ids.add(occurrence === 0 ? slug : `${slug}-${occurrence}`);
    counts.set(slug, occurrence + 1);
  }

  return ids;
}

function assertLocalMarkdownLinksResolve(relativePath: string): void {
  for (const { path, anchor } of localMarkdownLinks(relativePath)) {
    const targetPath = path
      ? resolve(root, dirname(relativePath), path)
      : resolve(root, relativePath);
    expect(existsSync(targetPath), `${relativePath} links to missing ${path ?? relativePath}`).toBe(
      true,
    );
    if (anchor) {
      expect(
        markdownAnchorIds(relative(root, targetPath)),
        `${relativePath} links to missing #${anchor}`,
      ).toContain(anchor);
    }
  }
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
      execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot });
      execFileSync("git", ["config", "user.name", "Publication test"], { cwd: fixtureRoot });
      execFileSync("git", ["config", "user.email", "publication@example.test"], {
        cwd: fixtureRoot,
      });
      execFileSync("git", ["add", ".gitignore", "docs/reference/config.md"], {
        cwd: fixtureRoot,
      });
      execFileSync("git", ["commit", "--quiet", "-m", "seed"], { cwd: fixtureRoot });

      expect(() =>
        execFileSync(
          "git",
          ["check-ignore", "--quiet", "--no-index", ".scratch/worktrees/other/generated.md"],
          {
            cwd: fixtureRoot,
          },
        ),
      ).not.toThrow();
      expect(findMaintainerDeploymentLeaks(fixtureRoot)).toEqual([]);

      writeFileSync(
        resolve(fixtureRoot, "docs/reference/nested.md"),
        "stacklet.app must fail the publication gate\n",
      );
      execFileSync("git", ["add", "docs/reference/nested.md"], { cwd: fixtureRoot });
      execFileSync("git", ["commit", "--quiet", "-m", "add nested leak"], { cwd: fixtureRoot });
      expect(findMaintainerDeploymentLeaks(fixtureRoot)).toEqual([
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

  it("publishes a bounded private vulnerability reporting path", () => {
    const entryPoint = read("SECURITY.md");
    const canonical = read("docs/security.md");

    expect(entryPoint).toContain("https://github.com/nick-neely/tendnote/security/advisories");
    expectAllMatch(entryPoint, [
      /sole reporting channel/i,
      /credentials[\s\S]*private records[\s\S]*personal data/i,
      /public Issues[\s\S]*pull requests/i,
      /seven calendar days/i,
      /best-effort acknowledgement/i,
      /not a remediation deadline/i,
    ]);
    expect(entryPoint).not.toMatch(/has been (?:certified|audited)/i);
    expect(entryPoint).not.toMatch(/comprehensive security coverage/i);
    expect(entryPoint).not.toMatch(/blanket security claim/i);

    expect(canonical).toContain("## Deterministic controls and their limits");
    expect(canonical).toContain("**Query**");
    expect(canonical).toContain("**Ownership**");
    expect(canonical).toContain("**Review**");
    expect(canonical).toContain("**Approval**");
    expect(canonical).toContain("**Fail closed**");
    expect(canonical).toMatch(/model-policy boundary/i);
    expect(canonical).toContain("## Self-host operator responsibilities");
    expect(canonical).toMatch(/backups and recovery/i);
    expect(canonical).toMatch(/security updates/i);
    expect(existsSync(resolve(root, "SECURITY.md"))).toBe(true);
  });

  it("publishes a fresh-clone contribution doorway with resolvable authority links", () => {
    const guide = read("CONTRIBUTING.md");
    const template = read(".github/pull_request_template.md");
    const agreement = read("docs/contributing.md");
    const support = read("docs/support.md");
    const legalReadme = read("docs/legal/README.md");
    const individualCla = read("docs/legal/individual-contributor-license-agreement.md");
    const employerAuthorization = read("docs/legal/employer-contribution-authorization.md");
    const corporateCla = read("docs/legal/corporate-contributor-license-agreement.md");

    for (const file of CONTRIBUTION_MARKDOWN_ENTRY_POINTS) {
      assertLocalMarkdownLinksResolve(file);
    }

    expect(localMarkdownLinks("README.md")).toContainEqual({
      path: "docs/local-development.md",
      anchor: "quality-gates",
    });
    expect(localMarkdownLinks("docs/support.md")).toContainEqual({
      path: "security.md",
      anchor: "self-host-operator-responsibilities",
    });

    expect(guide).toContain("README");
    expect(guide).toContain("docs/local-development.md");
    expect(guide).toContain("docs/ci-contributing.md");
    expect(guide).toContain(".github/pull_request_template.md");
    expect(guide).toContain("SECURITY.md");
    expect(guide).toContain("docs/security.md");
    expect(guide).toContain("docs/support.md");
    expect(guide).toContain("docs/legal/README.md");
    expect(guide).toMatch(
      /open an Issue before[\s\S]*material behavior[\s\S]*architecture[\s\S]*privacy/i,
    );
    expect(guide).toMatch(/documentation corrections[\s\S]*self-contained test fixes/i);
    expect(guide).toMatch(
      /unsigned\s+or\s+declined external\s+pull\s+request remains open but cannot merge/i,
    );
    expect(guide).toMatch(/Issues are open with no\s+service-level\s+agreement/i);
    expect(guide).toMatch(/self-hosting support is community-only/i);
    expect(guide).toContain("docs/ci-contributing.md#verification-labels");
    expect(guide).toContain(".github/rulesets/protect-main.json");
    expect(guide).toMatch(
      /CLA Assistant (?:desired-state )?manifest[\s\S]*redacted proof schema[\s\S]*operator runbook/i,
    );
    expect(guide).toMatch(
      /hosted activation[\s\S]*actual CLA status context[\s\S]*owner-gated work in #473/i,
    );
    expect(guide).toMatch(/does not claim current CLA enforcement or live proof/i);
    expect(guide).toMatch(
      /agreement packet[\s\S]*counsel-reviewed[\s\S]*owner-approved[\s\S]*effective 2026-08-21/i,
    );
    expect(guide).toMatch(/owner-confirmed as executed/i);
    expect(guide).toMatch(/does\s+not\s+claim\s+that counsel[\s\S]*verified/i);
    for (const document of [guide, support]) {
      expect(document).toMatch(/synthetic fixtures[\s\S]*minimized\s+reproductions/i);
      expect(document).toMatch(/personal data[\s\S]*public Issue[\s\S]*pull\s+request/i);
      expect(document).not.toMatch(/unrelated\s+personal\s+data/i);
    }

    expect(template).toContain("## Related Issues");
    expect(template).toContain("## User-visible impact");
    expect(template).toContain("## Privacy-boundary impact");
    expect(template).toContain("## Checks run");
    expect(template).toContain("AI assistance (optional)");
    expect(template).toContain("Generated-by:");
    expect(template).not.toMatch(
      /(?:^|\n)##[^\n]*(?:prompt|raw model output|account information|usage data)/i,
    );

    expect(agreement).toMatch(
      /agreement packet[\s\S]*counsel-reviewed[\s\S]*owner-approved[\s\S]*effective 2026-08-21/i,
    );
    expectAllMatch(agreement, [
      /not a\s+Contributor License Agreement/i,
      /owner-confirmed as executed/i,
      /does\s+not\s+claim\s+that counsel\s+has\s+verified/i,
    ]);
    expect(agreement).not.toMatch(/has not been executed or verified/i);
    expect(agreement).toMatch(/CLA Assistant/i);
    expect(agreement).toContain("legal/README.md");
    expect(agreement).toContain("Generated-by:");
    expect(agreement).toMatch(
      /counsel-reviewed[\s\S]*Apache ICLA-derived\s+individual\s+agreement/i,
    );
    expect(agreement).toMatch(/effective 2026-08-21/i);

    expectAllMatch(support, [
      /no\s+service\s+level\s+agreement/i,
      /self-host support is community-only/i,
      /private reporting path/i,
    ]);

    expectAllMatch(legalReadme, [
      /individual\s+contributor\s+license\s+agreement/i,
      /employer\s+contribution\s+authorization/i,
      /corporate\s+contributor\s+license\s+agreement/i,
      /records\s+are\s+private/i,
      /CLA status may be public/i,
    ]);
    expect(legalReadme).toMatch(
      /Version 1\.0[\s\S]*counsel-reviewed[\s\S]*owner-approved[\s\S]*effective 2026-08-21/i,
    );
    expect(legalReadme).toMatch(/CLA Assistant[\s\S]*owner-gated work in[\s\S]*#473/i);
    expect(legalReadme).toMatch(/do not claim that the hosted service is currently live/i);
    expect(legalReadme).not.toMatch(/DRAFT|PENDING COUNSEL APPROVAL/i);

    for (const agreementDocument of [individualCla, employerAuthorization, corporateCla]) {
      expect(agreementDocument).toMatch(/Version 1\.0/i);
      expect(agreementDocument).toMatch(/effective 2026-08-21/i);
      expect(agreementDocument).not.toMatch(/DRAFT|PENDING COUNSEL APPROVAL/i);
      expect(agreementDocument).not.toMatch(
        /proposed final-form|exact legal names[\s\S]*must be confirmed|Counsel must|counsel must/i,
      );
    }

    expectAllMatch(individualCla, [
      /Tendnote Individual Contributor License Agreement/i,
      /Version 1\.0/i,
      /CLA Assistant/i,
      /Contributor retains ownership/i,
    ]);
    expect(individualCla).toMatch(
      /perpetual[\s\S]*worldwide[\s\S]*non-exclusive[\s\S]*royalty-free[\s\S]*irrevocable/i,
    );
    expectAllMatch(individualCla, [
      /sublicense\s+and\s+relicense/i,
      /open-source\s+and\s+commercial\s+distribution/i,
      /necessarily infringed/i,
      /patent license[\s\S]*terminate/i,
      /legally entitled/i,
      /employer/i,
      /third-party material/i,
      /AI-assisted Contributions are permitted/i,
      /tool terms/i,
      /knows[\s\S]*third-party/i,
      /not request prompts/i,
      /no support/i,
      /AS IS/i,
      /no obligation to accept/i,
      /electronic record/i,
      /entire agreement/i,
      /severed/i,
      /electronic\s+counterparts/i,
      /Acceptance record/i,
    ]);
    expect(individualCla).not.toMatch(/Proposed acceptance record/i);

    expectAllMatch(employerAuthorization, [
      /authorized employer representative/i,
      /GitHub account/i,
      /scope/i,
      /one-off/i,
      /named contributor/i,
      /copyright license/i,
      /patent license/i,
      /AI-assisted Contributions are permitted/i,
      /third-party material/i,
      /signed/i,
    ]);

    expectAllMatch(corporateCla, [
      /reusable entity agreement/i,
      /authorized contributor schedule/i,
      /GitHub account/i,
      /copyright license/i,
      /patent license/i,
      /third-party material/i,
      /AI-assisted Contributions are permitted/i,
      /update duties/i,
      /no support/i,
      /entire agreement/i,
      /severed/i,
      /electronic\s+counterparts/i,
    ]);
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
