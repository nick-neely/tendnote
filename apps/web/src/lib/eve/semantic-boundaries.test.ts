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
      .map((file) => file.replace(/(^|\/)\([^/]+\)\//g, "$1"))
      .map((file) => (file === "page.tsx" ? "/" : file.replace(/\/page\.tsx$/, "")))
      .sort();

    // The relationship-data product routes are the dashboard and people pages
    // plus the Phase 5 private Actions surface (#178), its narrow Action Today
    // glance (#186), the Phase 6 Assets surface and Asset Profile (#197), and
    // Phase 7's source-grounded Saved Items surface (#265);
    // account/auth surfaces, Phase 2E's explicit Contacts import preview entry,
    // the owner-scoped Discord delivery settings (#173), Account → About you and
    // its assistant import round trip, Account → Household's activation and
    // return point (#378), and optional Self Context onboarding are allowed
    // alongside them but carry no semantic-search route.
    expect(pageRoutes).toEqual([
      "/",
      "account",
      "account/about-you",
      "account/about-you/import",
      "account/contacts/import",
      "account/discord",
      "account/household",
      "actions",
      "actions/today",
      "assets",
      "assets/[assetId]",
      "forgot-password",
      // The Household Invitation acceptance capability (#379). Reachable only
      // from an emailed link, never from navigation, and it carries no
      // relationship or semantic-search surface.
      "join/[token]",
      "onboarding/self-context",
      "pending",
      "people",
      "people/[personId]",
      "reminders/open",
      "reset-password",
      "saved-items",
      "sign-in",
      "sign-up",
    ]);
    expect(pageRoutes).not.toEqual(
      expect.arrayContaining(["semantic", "semantic-search", "search", "embeddings", "vector"]),
    );
  });
});
