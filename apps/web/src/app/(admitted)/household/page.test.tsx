import type { HouseholdHomeSectionView } from "@tendnote/domain/household-home";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdmittedHouseholdForUser,
  getHouseholdCheckin,
  getHouseholdHome,
  getOwnerTodayContext,
  redirect,
  requireAdmittedOwner,
  unstable_rethrow,
} = vi.hoisted(() => ({
  getAdmittedHouseholdForUser: vi.fn(),
  getHouseholdCheckin: vi.fn(),
  getHouseholdHome: vi.fn(),
  getOwnerTodayContext: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  requireAdmittedOwner: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => ({ getAdmittedHouseholdForUser }));
vi.mock("@tendnote/db/queries/household-home", () => ({ getHouseholdCheckin, getHouseholdHome }));
vi.mock("@tendnote/db/queries/today", () => ({ getOwnerTodayContext }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ redirect, unstable_rethrow }));
// The choice is a client component whose server action pulls in `server-only`.
// Its own behaviour is covered where it lives; here it stands for "the offer is
// on the page" so the page's composition can be asserted at all.
vi.mock("@/components/household/household-checkin-choice", () => ({
  HouseholdCheckinChoice: ({ enabled }: { enabled: boolean }) => (
    <p>{enabled ? "Remove the check-in from my brief" : "Add a check-in to my brief"}</p>
  ),
}));
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
import HouseholdHomePage, {
  HouseholdCheckinStream,
  HouseholdHomeContent,
  HouseholdHomeStream,
} from "./page";

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
  getHouseholdCheckin.mockResolvedValue({
    household: { id: "household-1", name: "Ash Lane" },
    optedIn: false,
    records: [],
    limitations: [],
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

  it("offers the check-in below both sections rather than as a third one", async () => {
    const markup = renderToStaticMarkup(await HouseholdHomeContent());

    // The home answers one question in two sections. The check-in is a member's
    // own private read offered from here, so it sits under them (ADR 0220).
    expect(markup.indexOf("Coming up")).toBeLessThan(markup.indexOf("check-in"));
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

  it("omits the check-in section entirely when nothing is timely, but keeps the offer", async () => {
    // An empty check-in is a standing request to go and find something. The
    // offer stays, because the member still has a decision to make.
    const markup = renderToStaticMarkup(
      await HouseholdCheckinStream({ householdName: "Ash Lane", ownerUserId: "owner-1" }),
    );

    expect(markup).toContain("Add a check-in to my brief");
    expect(markup).not.toContain("Household check-in");
  });

  it("shows the opted-in member their capped read, named as their own view", async () => {
    getHouseholdCheckin.mockResolvedValue({
      household: { id: "household-1", name: "Ash Lane" },
      optedIn: true,
      records: [
        {
          identity: "routine:a",
          family: "routine",
          section: "needs_attention",
          pressing: true,
          record: { kind: "general_action", id: "a", href: "/actions#a" },
          title: "Put the bins out",
          context: "Routine · weekly",
          timing: { code: "due_today", explanation: "Due today" },
          scopeLabel: "Household",
          responsibility: null,
          progress: null,
          at: new Date("2026-07-21T09:00:00.000Z"),
          createdAt: new Date("2026-07-01T09:00:00.000Z"),
        },
      ],
      limitations: [],
    });

    const markup = renderToStaticMarkup(
      await HouseholdCheckinStream({ householdName: "Ash Lane", ownerUserId: "owner-1" }),
    );

    expect(markup).toContain("Household check-in");
    expect(markup).toContain("Put the bins out");
    expect(markup).toContain('href="/actions#a"');
    // The boundary in words, and no inline mutation: the row links to the record
    // and the record's own surface owns every decision about it. On the household's
    // own page the line says what the section is *for* rather than repeating the
    // household's name, which is already the page's heading.
    expect(markup).toContain("The short version, in your own brief");
    expect(markup).not.toContain("as you can see it");
    expect(markup).not.toContain("<button");
  });

  it("says nothing at all when the check-in cannot be read", async () => {
    getHouseholdCheckin.mockRejectedValue(new Error("unavailable"));

    const rendered = await HouseholdCheckinStream({
      householdName: "Ash Lane",
      ownerUserId: "owner-1",
    });

    // Not an error state and not an empty state: the smallest thing on the page
    // must never claim the household is quiet when it could not look.
    expect(rendered).toBeNull();
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
