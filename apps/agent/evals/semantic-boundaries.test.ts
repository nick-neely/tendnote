import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = join(import.meta.dirname, "../agent");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const rel = relative(agentRoot, path);
    if (entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return listFiles(path);
    return [rel];
  });
}

describe("semantic retrieval Phase 1D boundaries", () => {
  it("does not expose proactive relationship agenda tooling in Phase 1D", () => {
    const files = listFiles(agentRoot);
    const toolFiles = files.filter((file) => file.startsWith("tools/"));

    expect(toolFiles).not.toEqual(
      expect.arrayContaining([
        "tools/get_relationship_agenda.ts",
        "tools/recommend_people.ts",
        "tools/rank_relationships.ts",
        "tools/who_to_check_in_with.ts",
      ]),
    );
  });

  it("keeps search_semantic_context framed as context finding, not ranking", () => {
    const toolDescriptions = listFiles(join(agentRoot, "tools"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join(agentRoot, file), "utf8"))
      .join("\n");
    const semanticSource = readFileSync(
      join(agentRoot, "tools/search_semantic_context.ts"),
      "utf8",
    );

    expect(semanticSource).toContain("proactive agenda ranking");
    expect(semanticSource).toContain("generated answers");
    expect(toolDescriptions).not.toMatch(
      /semantic(?:.|\n){0,160}(recommend|prioriti[sz]e|rank|who should|check in)/i,
    );
  });
});
