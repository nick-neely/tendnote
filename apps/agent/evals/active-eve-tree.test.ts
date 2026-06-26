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
});
