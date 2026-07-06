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

    // The relationship-data product routes are the dashboard and people pages
    // plus the Phase 5 private Actions surface (#178); account/auth surfaces,
    // Phase 2E's explicit Contacts import preview entry, and the owner-scoped
    // Discord delivery settings (#173) are allowed alongside them but carry no
    // semantic-search route.
    expect(pageRoutes).toEqual([
      "/",
      "account",
      "account/contacts/import",
      "account/discord",
      "actions",
      "forgot-password",
      "pending",
      "people",
      "people/[personId]",
      "reset-password",
      "sign-in",
      "sign-up",
    ]);
    expect(pageRoutes).not.toEqual(
      expect.arrayContaining(["semantic", "semantic-search", "search", "embeddings", "vector"]),
    );
  });
});
