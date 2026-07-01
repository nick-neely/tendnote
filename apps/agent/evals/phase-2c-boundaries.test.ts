import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "../agent");
const repoRoot = join(import.meta.dirname, "../../..");

/**
 * Phase 2C agent-surface boundaries (PRD #105, ADR-0074). Phase 2C adds Eve's
 * narrow READ-ONLY Google Calendar read tool, deliberately crossing the Phase 2B
 * "no provider tools" boundary. These assertions pin what remains true: the only
 * provider tool is the read-only Calendar read (no Gmail/Contacts/OAuth tools), the
 * agent surface hardcodes no provider API host (the shared db seam owns provider
 * HTTP via injected adapters), the Calendar tool performs no durable writes, and
 * Eve still has only its same-origin channel.
 */

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

describe("Phase 2C agent-surface boundaries", () => {
  it("adds no agent/connections provider integration surface", () => {
    expect(existsSync(join(agentRoot, "connections"))).toBe(false);
  });

  it("exposes only the read-only Calendar read tool and the Phase 2D Gmail draft-write tool", () => {
    const tools = readdirSync(join(agentRoot, "tools"));
    // Calendar's only Eve tool is the read.
    expect(tools.filter((name) => /calendar/i.test(name))).toEqual(["list_calendar_events.ts"]);
    // Phase 2D adds exactly one Gmail tool: a DRAFT-WRITE tool behind the shared
    // approval gate (no Gmail read/history/send). Contacts and generic OAuth tools
    // stay absent (their phases haven't landed).
    expect(tools.filter((name) => /gmail|contacts|oauth/i.test(name)).sort()).toEqual([
      "save_draft_to_gmail.ts",
    ]);
  });

  it("hardcodes no provider API host on the agent surface (the db seam owns HTTP)", () => {
    const sources = readSources(agentRoot);
    for (const forbidden of ["googleapis.com", "accounts.google.com"]) {
      expect(sources).not.toContain(forbidden);
    }
  });

  it("keeps the Calendar tool read-only — no durable-write query imports", () => {
    const calendarSources = [
      "tools/list_calendar_events.ts",
      "lib/calendar.ts",
      "lib/calendar-read.ts",
    ]
      .map((file) => readFileSync(join(agentRoot, file), "utf8").toLowerCase())
      .join("\n");
    for (const forbidden of [
      "queries/memories",
      "queries/followups",
      "queries/drafts",
      "queries/source-records",
      "capturememory",
      "createperson",
      "proposefollowup",
      "createmessagedraft",
    ]) {
      expect(calendarSources).not.toContain(forbidden);
    }
  });

  it("adds no provider delivery channels — only the same-origin Eve channel", () => {
    expect(readdirSync(join(agentRoot, "channels"))).toEqual(["eve.ts"]);
  });

  it("keeps the governing ADRs present", () => {
    for (const adr of [
      "0069-provider-connections-before-google-oauth.md",
      "0074-eve-can-read-connected-calendar-live.md",
    ]) {
      expect(existsSync(join(repoRoot, "docs", "adr", adr))).toBe(true);
    }
  });
});
