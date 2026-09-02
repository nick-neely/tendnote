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
    // return point (#378) with its Household Context subpage beneath Overview
    // (#382), and optional Self Context onboarding are allowed alongside them
    // but carry no semantic-search route.
    expect(pageRoutes).toEqual([
      "/",
      "account",
      "account/about-you",
      "account/about-you/import",
      "account/contacts/import",
      "account/discord",
      "account/household",
      "account/household/context",
      "actions",
      "actions/today",
      "assets",
      "assets/[assetId]",
      // The Assistant destination and one resumable thread (ADR 0238). Threads
      // are Tendnote-owned titles over Eve sessions and hold no transcript, so
      // neither route is a semantic-search surface.
      "assistant",
      "assistant/[sessionId]",
      "forgot-password",
      // Phase 8 Gift Plans and one plan's own page (#389). They read through the
      // Gift Plan seam's own proved search, never semantic retrieval — a Gift
      // Plan is not an embedded record kind, precisely so a Surprise Subject
      // cannot meet one in ranked recall.
      "gift-plans",
      "gift-plans/[giftPlanId]",
      // The shared Household home (#384). A deterministic, capped read over
      // records the caller is separately proved to see, composed from each
      // domain's own listing — never ranked or semantic retrieval, so nothing
      // reaches it by resembling a household record rather than being one.
      "household",
      // The Household Invitation acceptance capability (#379). Reachable only
      // from an emailed link, never from navigation, and it carries no
      // relationship or semantic-search surface.
      "join/[token]",
      "onboarding/self-context",
      "pending",
      "people",
      "people/[personId]",
      // The Phase 9a launch prototype (#457). A public, self-contained mock with
      // no data access at all, so it reaches neither proved reads nor semantic
      // retrieval.
      "prototype/phase-9a-launch",
      "reminders/open",
      "reset-password",
      "saved-items",
      // The one Relationship Share a direct request names (#388). A single
      // proof-gated record, never a browsable set: there is no `/shared`
      // index, and nothing reachable from it is searchable.
      "shared/[recordKind]/[recordId]",
      "sign-in",
      "sign-up",
    ]);
    expect(pageRoutes).not.toEqual(
      expect.arrayContaining(["semantic", "semantic-search", "search", "embeddings", "vector"]),
    );
  });
});
