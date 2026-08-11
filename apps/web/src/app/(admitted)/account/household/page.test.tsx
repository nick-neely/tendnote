import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHouseholdOverviewForUser,
  listHouseholdContextActors,
  listHouseholdContextFacts,
  requireAdmittedOwner,
  unstable_rethrow,
} = vi.hoisted(() => ({
  getHouseholdOverviewForUser: vi.fn(),
  listHouseholdContextActors: vi.fn(),
  listHouseholdContextFacts: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => ({
  getHouseholdOverviewForUser,
  listHouseholdContextActors,
}));
vi.mock("@tendnote/db/queries/context-facts", () => ({ listHouseholdContextFacts }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));
vi.mock("@/components/account/household-surface", () => ({
  HouseholdSurface: ({
    initialOverview,
    sharedSections,
  }: {
    initialOverview: { name: string } | null;
    sharedSections?: unknown;
  }) => (
    <div data-testid="household-surface">
      {initialOverview ? `active: ${initialOverview.name}` : "no active household"}
      {sharedSections ? " with shared sections" : " without shared sections"}
    </div>
  ),
}));
// The shared Calendar and Event Plan sections read on the server and render as
// their own client subtree; this route's own contract is the gate above them.
vi.mock("@/lib/household/household-shared-data", () => ({
  getHouseholdSharedContext: vi.fn(),
}));
vi.mock("@/components/account/household-shared-sections", () => ({
  HouseholdSharedSections: () => null,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RouteReserve } from "@/components/route-reserve";
import HouseholdPage, { HouseholdContent } from "./page";

const OVERVIEW = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner" as const,
  members: [],
  seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
  isSoleMember: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  getHouseholdOverviewForUser.mockResolvedValue(null);
  listHouseholdContextFacts.mockResolvedValue([]);
  listHouseholdContextActors.mockResolvedValue([]);
});

describe("Household route", () => {
  it("has a truthful loading reserve for the focused destination", () => {
    expect(renderToStaticMarkup(<RouteReserve destination="account-household" />)).toContain(
      "Household",
    );
  });

  /**
   * The owner-scoped read streams behind `AdmittedRoute`'s Suspense boundary, so
   * a navigation paints the destination's reserve rather than nothing. That is
   * what makes a separate `loading.tsx` redundant here, exactly as on every other
   * admitted destination — this pins the wiring so the reserve cannot be orphaned
   * by someone unwrapping the page.
   */
  it("streams the household read behind that reserve", () => {
    const element = HouseholdPage() as {
      props: { destination: string; children: unknown };
    };

    expect(element.props.destination).toBe("account-household");
    expect(renderToStaticMarkup(element as never)).toContain("Household");
  });

  it("gates the household read on the admitted caller and returns them to Account", async () => {
    const markup = renderToStaticMarkup(await HouseholdContent());

    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/account/household" });
    expect(getHouseholdOverviewForUser).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(markup).toContain("no active household");
    expect(markup).toContain('href="/account"');
  });

  it("hands the caller's own household to the surface when they have one", async () => {
    getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);

    expect(renderToStaticMarkup(await HouseholdContent())).toContain("active: The Neely house");
  });

  /**
   * The shared calendars and Event Plans are read through the same active
   * membership the Overview is read through, so a caller who has no household
   * is never handed a subtree that would go looking for one.
   */
  it("offers the shared sections only alongside an active household", async () => {
    expect(renderToStaticMarkup(await HouseholdContent())).toContain("without shared sections");

    getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
    expect(renderToStaticMarkup(await HouseholdContent())).toContain("with shared sections");
  });

  it("reads only the caller's household, never another account's", async () => {
    getHouseholdOverviewForUser.mockImplementation(({ userId }: { userId: string }) =>
      Promise.resolve(userId === "owner-1" ? OVERVIEW : null),
    );

    const ownerMarkup = renderToStaticMarkup(await HouseholdContent());
    requireAdmittedOwner.mockResolvedValue("owner-2");
    const otherMarkup = renderToStaticMarkup(await HouseholdContent());

    expect(ownerMarkup).toContain("active: The Neely house");
    expect(otherMarkup).toContain("no active household");
    expect(otherMarkup).not.toContain("The Neely house");
  });

  /**
   * Household Context rides under Overview, so it is read only for a caller who
   * has a household — a caller with none must not cause a shared-context read at
   * all (#382).
   */
  it("reads shared context only once there is a household to read it for", async () => {
    const markup = renderToStaticMarkup(await HouseholdContent());
    expect(markup).toContain("no active household");
    expect(listHouseholdContextFacts).not.toHaveBeenCalled();

    getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
    renderToStaticMarkup(await HouseholdContent());

    expect(listHouseholdContextFacts).toHaveBeenCalledWith(
      { callerUserId: "owner-1" },
      expect.any(Function),
    );
    expect(listHouseholdContextActors).toHaveBeenCalledWith({ userId: "owner-1" });
  });

  it("keeps the destination truthful when the household read is unavailable", async () => {
    const failure = new Error("database unavailable");
    getHouseholdOverviewForUser.mockRejectedValue(failure);

    const markup = renderToStaticMarkup(await HouseholdContent());

    expect(markup).toContain("Household is temporarily unavailable.");
    expect(markup).toContain("Nothing changed.");
    expect(unstable_rethrow).toHaveBeenCalledWith(failure);
  });
});
