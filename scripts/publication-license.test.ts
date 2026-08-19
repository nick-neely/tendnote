import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("fresh-clone publication gate", () => {
  it("identifies the complete outbound AGPL license", () => {
    const license = read("LICENSE");
    const packageManifest = JSON.parse(read("package.json")) as { license?: string };
    const readme = read("README.md");

    expect(packageManifest.license).toBe("AGPL-3.0-only");
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 19 November 2007");
    expect(license).toContain("13. Remote Network Interaction");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(readme).toContain("[AGPL-3.0-only](LICENSE)");
  });

  it("records every current redistributed Impeccable variant", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");
    const apacheLicense = read("LICENSES/Apache-2.0.txt");

    expect(apacheLicense).toContain("Apache License");
    expect(apacheLicense).toContain("Version 2.0, January 2004");
    expect(apacheLicense).toContain("Copyright 2025 Paul Bakaus");
    expect(notices).toContain("pbakaus/impeccable");
    expect(notices).toContain("skill-v4.0.2");
    expect(notices).toMatch(/Retrieved:\*\*? 2026-08-19/);
    expect(notices).toContain("Copyright 2025 Paul Bakaus");
    expect(notices).toMatch(/No NOTICE file is present in that\s+upstream release/);
    expect(notices).toContain(".agents/skills/impeccable/");
    expect(notices).toContain(".claude/skills/impeccable/");
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

  it("keeps current configuration examples maintainer-neutral", () => {
    const currentFiles = [
      "apps/web/.env.example",
      "apps/agent/.env.example",
      "apps/web/src/lib/email/transactional.ts",
      "packages/domain/src/household-governance.ts",
      "docs/email-setup.md",
    ];
    const currentTree = currentFiles.map((file) => read(file)).join("\n");

    expect(currentTree).not.toContain("stacklet.app");
    expect(currentTree).not.toContain("nick-neely");
    expect(currentTree).not.toMatch(/dpl_[A-Za-z0-9]+/);
    expect(currentTree).toContain("BETTER_AUTH_URL");
    expect(currentTree).toContain("<BETTER_AUTH_URL>");
    expect(currentTree).toContain("example.com");
  });

  it("labels deployment records as historical evidence rather than configuration", () => {
    for (const file of [
      "docs/verification/nextjs-16-3-partial-prefetching.md",
      "docs/verification/nextjs-16-3-preview-qualification.md",
      "docs/verification/phase-7-personal-os.md",
    ]) {
      expect(read(file)).toContain("Historical qualification evidence");
    }
  });
});
