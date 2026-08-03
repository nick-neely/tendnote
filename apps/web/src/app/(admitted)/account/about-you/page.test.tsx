import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listSelfContextFacts,
  listSuggestedContextFactReviews,
  requireAdmittedOwner,
  unstable_rethrow,
} = vi.hoisted(() => ({
  listSelfContextFacts: vi.fn(),
  listSuggestedContextFactReviews: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({
  listSelfContextFacts,
  listSuggestedContextFactReviews,
}));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));
vi.mock("@/components/account/about-you-surface", () => ({
  AboutYouSurface: ({
    initialFacts,
    initialSuggestedReviews,
  }: {
    initialFacts: unknown[];
    initialSuggestedReviews: unknown[];
  }) => (
    <div data-testid="about-you-surface">
      {initialFacts.length} facts, {initialSuggestedReviews.length} suggestions
    </div>
  ),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RouteReserve } from "@/components/route-reserve";
import { AboutYouContent } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  listSelfContextFacts.mockResolvedValue([]);
  listSuggestedContextFactReviews.mockResolvedValue([]);
});

describe("About you route", () => {
  it("has a truthful loading reserve for the focused destination", () => {
    // The route streams behind `AdmittedRoute`'s reserve rather than a second
    // hand-built skeleton, so the destination registration is what has to be true.
    expect(renderToStaticMarkup(<RouteReserve destination="account-about-you" />)).toContain(
      "About you",
    );
  });

  it("re-resolves the admitted caller for the Self Context read", async () => {
    const facts = [{ id: "fact-1" }];
    listSelfContextFacts.mockResolvedValue(facts);

    const markup = renderToStaticMarkup(await AboutYouContent());

    expect(markup).toContain("1 facts");
    expect(listSelfContextFacts).toHaveBeenCalledWith(
      { callerUserId: "owner-1", includeArchived: true },
      requireAdmittedOwner,
    );
    expect(listSuggestedContextFactReviews).toHaveBeenCalledWith(
      { callerUserId: "owner-1" },
      requireAdmittedOwner,
    );
    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/account/about-you" });
  });

  it("keeps another owner's private facts out of the focused route", async () => {
    const privateFact = { id: "owner-1-fact", content: "Owner one private fact" };
    listSelfContextFacts.mockImplementation(({ callerUserId }: { callerUserId: string }) =>
      Promise.resolve(callerUserId === "owner-1" ? [privateFact] : []),
    );

    const ownerOneMarkup = renderToStaticMarkup(await AboutYouContent());
    requireAdmittedOwner.mockResolvedValue("owner-2");
    const ownerTwoMarkup = renderToStaticMarkup(await AboutYouContent());

    expect(ownerOneMarkup).toContain("1 facts");
    expect(ownerTwoMarkup).toContain("0 facts");
    expect(ownerTwoMarkup).not.toContain(privateFact.content);
    expect(listSelfContextFacts).toHaveBeenLastCalledWith(
      { callerUserId: "owner-2", includeArchived: true },
      requireAdmittedOwner,
    );
    expect(listSuggestedContextFactReviews).toHaveBeenLastCalledWith(
      { callerUserId: "owner-2" },
      requireAdmittedOwner,
    );
  });

  it("keeps the destination truthful when the owner-scoped read is unavailable", async () => {
    const failure = new Error("database unavailable");
    listSelfContextFacts.mockRejectedValue(failure);

    const markup = renderToStaticMarkup(await AboutYouContent());

    expect(markup).toContain("About you is temporarily unavailable.");
    expect(markup).toContain("Try again");
    expect(unstable_rethrow).toHaveBeenCalledWith(failure);
  });
});
