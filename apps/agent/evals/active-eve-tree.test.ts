import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "../agent");

function listAuthoredFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const rel = relative(agentRoot, path);
    if (entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return listAuthoredFiles(path);
    return [rel];
  });
}

describe("active Eve tree", () => {
  it("does not add inactive future schedules, connections, subagents, or placeholders", () => {
    const files = listAuthoredFiles(agentRoot);

    expect(files.some((file) => file.startsWith("schedules/"))).toBe(false);
    expect(files.some((file) => file.startsWith("connections/"))).toBe(false);
    expect(files.some((file) => file.startsWith("subagents/"))).toBe(false);
    expect(files.some((file) => /placeholder|stub|future/i.test(file))).toBe(false);
  });

  it("has no background follow-up scanner or periodic suggestion generator (Phase 1E)", () => {
    const toolFiles = listAuthoredFiles(agentRoot).filter((file) => file.startsWith("tools/"));

    // Suggested follow-ups are produced only by the explicit-flow propose tool;
    // no tool scans/sweeps everyone or runs on a schedule to invent follow-ups
    // (PRD #42, issue #49).
    expect(toolFiles.some((file) => /scan|sweep|digest|cron|background|periodic/i.test(file))).toBe(
      false,
    );
    // The only tool that creates suggested follow-ups is the explicit propose
    // tool; the rest of the suggested-follow-up tools only review existing ones.
    const followupProducers = toolFiles.filter(
      (file) => /followup/i.test(file) && /propose|generate|create_suggest/i.test(file),
    );
    expect(followupProducers).toEqual(["tools/propose_followup.ts"]);
  });

  it("does not add extraction review tools, sandboxes, or user-facing model-debugging surfaces", () => {
    const files = listAuthoredFiles(agentRoot);
    const toolFiles = files.filter((file) => file.startsWith("tools/"));

    expect(files.some((file) => /extraction.*(inbox|sandbox|debug|mode)/i.test(file))).toBe(false);
    expect(toolFiles.some((file) => /extract|model|debug/i.test(file))).toBe(false);
    expect(toolFiles).toEqual(
      expect.arrayContaining([
        "tools/list_suggested_memory_reviews.ts",
        "tools/get_suggested_memory_review.ts",
        "tools/approve_suggested_memory.ts",
        "tools/dismiss_suggested_memory.ts",
      ]),
    );
  });
});
