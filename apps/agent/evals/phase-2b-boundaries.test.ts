import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "../agent");
const repoRoot = join(import.meta.dirname, "../../..");

/**
 * Phase 2B boundary evals on the Eve/agent surface (PRD #98, ADR-0069). Phase 2B
 * builds an inert Provider Connection foundation; the agent must gain no provider
 * integration files, no provider-reading tools, and no provider delivery channels.
 */

/** All non-test TypeScript sources under `root`, lowercased and concatenated. */
function readSources(root: string): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(root);
  return out.join("\n").toLowerCase();
}

describe("Phase 2B agent-surface boundaries", () => {
  it("adds no agent/connections provider integration surface", () => {
    // PRD #98 Out of Scope: Eve `agent/connections/` provider integration files.
    expect(existsSync(join(agentRoot, "connections"))).toBe(false);
  });

  it("adds no Eve provider tools for Calendar, Gmail, Contacts, or other providers", () => {
    // PRD #98 Out of Scope: Eve tools for Calendar, Gmail, Contacts, or other providers.
    const tools = readdirSync(join(agentRoot, "tools"));
    const providerToolPattern = /calendar|gmail|contacts|google|oauth|provider/i;
    expect(tools.filter((name) => providerToolPattern.test(name))).toEqual([]);
  });

  it("makes no live provider API calls anywhere on the agent surface", () => {
    // No Calendar/Contacts reads, Gmail reads/draft creation, or Contacts import:
    // every such call would reach a Google API host.
    const sources = readSources(agentRoot);
    for (const forbidden of ["googleapis.com", "accounts.google.com"]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("adds no provider delivery channels — only the same-origin Eve channel", () => {
    expect(readdirSync(join(agentRoot, "channels"))).toEqual(["eve.ts"]);
  });

  it("keeps ADR-0069 present", () => {
    expect(
      existsSync(join(repoRoot, "docs", "adr", "0069-provider-connections-before-google-oauth.md")),
    ).toBe(true);
  });
});
