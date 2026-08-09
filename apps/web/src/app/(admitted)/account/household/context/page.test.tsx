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
vi.mock("@/components/account/household-context-surface", () => ({
  HouseholdContextSurface: ({ initialFacts }: { initialFacts: { id: string }[] }) => (
    <div data-testid="household-context-surface">{`facts: ${initialFacts.length}`}</div>
  ),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RouteReserve } from "@/components/route-reserve";
import HouseholdContextPage, { HouseholdContextContent } from "./page";

const OVERVIEW = { householdId: "household-1", name: "The Neely house" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
  listHouseholdContextFacts.mockResolvedValue([{ id: "fact-1" }]);
  listHouseholdContextActors.mockResolvedValue([]);
});

describe("Household context route", () => {
  it("has a truthful loading reserve for the focused destination", () => {
    expect(
      renderToStaticMarkup(<RouteReserve destination="account-household-context" />),
    ).toContain("Household context");
  });

  it("streams the shared-context read behind that reserve", () => {
    const element = HouseholdContextPage() as { props: { destination: string } };
    expect(element.props.destination).toBe("account-household-context");
  });

  it("gates the read on the admitted caller and returns them to the subpage", async () => {
    await HouseholdContextContent();
    expect(requireAdmittedOwner).toHaveBeenCalledWith({
      returnTo: "/account/household/context",
    });
  });

  /**
   * The management read includes archived facts, because progressive disclosure
   * of the archive is part of this page and nowhere else.
   */
  it("reads the caller's own shared context, archive included", async () => {
    const markup = renderToStaticMarkup(await HouseholdContextContent());

    expect(listHouseholdContextFacts).toHaveBeenCalledWith(
      { callerUserId: "owner-1", includeArchived: true },
      expect.any(Function),
    );
    expect(markup).toContain("facts: 1");
    expect(markup).toContain('href="/account/household"');
  });

  /**
   * A caller whose membership ended between navigations must land somewhere
   * truthful rather than on an empty management screen that implies a household.
   */
  it("says there is nothing here when the caller is in no household", async () => {
    getHouseholdOverviewForUser.mockResolvedValue(null);

    const markup = renderToStaticMarkup(await HouseholdContextContent());

    expect(markup).toContain("There’s nothing to show here.");
    expect(listHouseholdContextFacts).not.toHaveBeenCalled();
  });

  it("keeps the destination truthful when the read is unavailable", async () => {
    const failure = new Error("database unavailable");
    listHouseholdContextFacts.mockRejectedValue(failure);

    const markup = renderToStaticMarkup(await HouseholdContextContent());

    expect(markup).toContain("Nothing changed.");
    expect(unstable_rethrow).toHaveBeenCalledWith(failure);
  });
});
