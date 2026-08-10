import type { HouseholdHomeSectionView } from "@tendnote/domain/household-home";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdmittedHouseholdForUser,
  getHouseholdHome,
  getOwnerTodayContext,
  redirect,
  requireAdmittedOwner,
  unstable_rethrow,
} = vi.hoisted(() => ({
  getAdmittedHouseholdForUser: vi.fn(),
  getHouseholdHome: vi.fn(),
  getOwnerTodayContext: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireAdmittedOwner: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => ({ getAdmittedHouseholdForUser }));
vi.mock("@tendnote/db/queries/household-home", () => ({ getHouseholdHome }));
vi.mock("@tendnote/db/queries/today", () => ({ getOwnerTodayContext }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ redirect, unstable_rethrow }));
vi.mock("@/components/household/household-home-section", () => ({
  HouseholdHomeSection: ({ view }: { view: HouseholdHomeSectionView }) => (
    <section>
      <h2>{view.heading}</h2>
      {view.records.map((record) => (
        <p key={record.identity}>{record.title}</p>
      ))}
    </section>
  ),
  HouseholdHomeSectionReserve: ({ heading }: { heading: string }) => <h2>{heading}</h2>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { RouteReserve } from "@/components/route-reserve";
import HouseholdHomePage, { HouseholdHomeContent, HouseholdHomeStream } from "./page";

function emptySection(
  section: "needs_attention" | "coming_up",
  heading: string,
): HouseholdHomeSectionView {
  return { section, heading, records: [], more: null, limitations: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  getOwnerTodayContext.mockResolvedValue({
    localDate: "2026-07-21",
    timeZone: "UTC",
    now: new Date("2026-07-21T15:00:00.000Z"),
  });
  getAdmittedHouseholdForUser.mockResolvedValue({ id: "household-1", name: "Ash Lane" });
  getHouseholdHome.mockResolvedValue({
    household: { id: "household-1", name: "Ash Lane" },
    needsAttention: emptySection("needs_attention", "Needs attention"),
    comingUp: emptySection("coming_up", "Coming up"),
  });
});

describe("the Household destination", () => {
  it("has a truthful loading reserve", () => {
    expect(renderToStaticMarkup(<RouteReserve destination="household" />)).toContain("Household");
  });

  it("streams the shared read behind that reserve", () => {
    const element = HouseholdHomePage() as { props: { destination: string } };
    expect(element.props.destination).toBe("household");
  });

  it("leads with the household's own name and says what the page is for", async () => {
    const markup = renderToStaticMarkup(await HouseholdHomeContent());

    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/household" });
    expect(markup).toContain("Ash Lane");
    expect(markup).toContain("coordinating together");
  });

  /**
   * The order is the same at every width, so the phone gets the same page rather
   * than a rearranged one. Asserted by position because the requirement is the
   * order itself, not that the headings exist.
   */
  it("keeps one column in the same order: Needs attention, Coming up, then links", async () => {
    const markup = renderToStaticMarkup(await HouseholdHomeContent());

    expect(markup.indexOf("Needs attention")).toBeLessThan(markup.indexOf("Coming up"));
    expect(markup.indexOf("Coming up")).toBeLessThan(markup.indexOf("Actions and Routines"));
  });

  it("offers the way back to governance without putting it in the page's work", async () => {
    const markup = renderToStaticMarkup(await HouseholdHomeContent());

    expect(markup).toContain('href="/account/household"');
    expect(markup).toContain("Manage household");
    expect(markup).not.toMatch(/invite|seat|owner/i);
  });

  it("composes each section for the caller against their own local day", async () => {
    getHouseholdHome.mockResolvedValue({
      household: { id: "household-1", name: "Ash Lane" },
      needsAttention: {
        ...emptySection("needs_attention", "Needs attention"),
        records: [{ identity: "routine:a", title: "Put the bins out" }],
      },
      comingUp: {
        ...emptySection("coming_up", "Coming up"),
        records: [{ identity: "action:b", title: "Parking permit" }],
      },
    });

    const needs = renderToStaticMarkup(
      await HouseholdHomeStream({ ownerUserId: "owner-1", sectionKey: "needsAttention" }),
    );
    const coming = renderToStaticMarkup(
      await HouseholdHomeStream({ ownerUserId: "owner-1", sectionKey: "comingUp" }),
    );

    expect(getHouseholdHome).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      localDate: "2026-07-21",
      timeZone: "UTC",
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    expect(needs).toContain("Put the bins out");
    expect(needs).not.toContain("Parking permit");
    expect(coming).toContain("Parking permit");
  });

  it("returns a member who no longer has a household to Account", async () => {
    getAdmittedHouseholdForUser.mockResolvedValue(null);

    await expect(HouseholdHomeContent()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/account/household");
    expect(getHouseholdHome).not.toHaveBeenCalled();
  });

  /**
   * "Nothing here" and "we could not look" are different facts, and a household
   * reading the wrong one would believe a chore had been dealt with. So a failed
   * read must never borrow the empty state's words.
   */
  it("says a section is unavailable rather than saying it is empty", async () => {
    getHouseholdHome.mockRejectedValue(new Error("composition offline"));

    const markup = renderToStaticMarkup(
      await HouseholdHomeStream({ ownerUserId: "owner-1", sectionKey: "needsAttention" }),
    );

    expect(markup).toContain("temporarily unavailable");
    expect(markup).toContain("Nothing changed.");
    expect(markup).not.toContain("composition offline");
    expect(markup).not.toMatch(/Nothing is waiting/);
  });
});
