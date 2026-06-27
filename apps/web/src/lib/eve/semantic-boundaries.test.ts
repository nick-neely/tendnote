import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "../../app");

function listAppFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const rel = relative(appRoot, path);
    if (statSync(path).isDirectory()) return listAppFiles(path);
    return [rel];
  });
}

describe("semantic retrieval product-route boundaries", () => {
  it("does not add a standalone semantic search page or route in Phase 1D", () => {
    const files = listAppFiles(appRoot);
    const pageRoutes = files
      .filter((file) => file.endsWith("page.tsx"))
      .map((file) => (file === "page.tsx" ? "/" : file.replace(/\/page\.tsx$/, "")))
      .sort();

    expect(pageRoutes).toEqual(["/", "people", "people/[personId]"]);
    expect(pageRoutes).not.toEqual(
      expect.arrayContaining(["semantic", "semantic-search", "search", "embeddings", "vector"]),
    );
  });
});
