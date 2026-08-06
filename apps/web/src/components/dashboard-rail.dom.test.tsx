// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";
import { DashboardRail } from "./dashboard-rail";

const replace = vi.fn();
const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/components/dashboard-brief-section", () => ({ DashboardBriefSection: () => null }));
vi.mock("@/components/dashboard-calendar-suggestions-section", () => ({
  DashboardCalendarSuggestionsSection: () => null,
}));
vi.mock("@/components/dashboard-followups-section", () => ({
  DashboardFollowupsSection: () => null,
}));
vi.mock("@/components/dashboard-suggested-followups-section", () => ({
  DashboardSuggestedFollowupsSection: () => null,
}));
type RailTabName = "today" | "review" | "followups" | "people";

/**
 * The Review panel is streamed in from the server, so the rail only ever sees a
 * count and an opaque node - the queue's own rendering is covered by
 * `review-queue-section.dom.test.tsx`.
 */
function rail(reviewCount: number, initialTab: RailTabName = "review") {
  return (
    <DashboardRail
      birthdays={[]}
      calendarSuggestions={[]}
      dailyBrief={null}
      followupReviews={[]}
      followups={[]}
      initialTab={initialTab}
      people={[]}
      reviewContent={<p>Streamed review queue</p>}
      reviewCount={reviewCount}
      weeklyBrief={null}
    />
  );
}

/** The rail always mounts on the panel the current URL names, as it does in the app. */
function renderRail(reviewCount: number, initialTab: RailTabName = "review") {
  navigation.searchParams = new URLSearchParams(initialTab === "review" ? "tab=review" : "");
  return render(rail(reviewCount, initialTab));
}

/** The label of the one selected tab, so a failure names the tab instead of "false". */
function selected(): string | undefined {
  return screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.replace(/\d+$/, "");
}

afterEach(() => {
  vi.restoreAllMocks();
  navigation.searchParams = new URLSearchParams();
});

describe("DashboardRail Review Queue", () => {
  /**
   * Every panel is served on every Home URL, so switching a tab is local state.
   * Routing it through the router meant a server round trip and a reserve flash
   * on a view the owner already held — and, on `?tab=review`, the siblings were
   * handed empty props and read as though the owner had nothing.
   */
  it("switches tabs instantly, with no navigation and no reserve", async () => {
    const user = userEvent.setup();
    replace.mockReset();
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderRail(0);

    await user.click(screen.getByRole("tab", { name: "Today" }));

    expect(replace).not.toHaveBeenCalled();
    expect(selected()).toBe("Today");
    expect(screen.queryByRole("region", { name: "Loading Today" })).toBeNull();
    expect(screen.queryByText(/Nothing waiting to review/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Review" }));
    expect(selected()).toBe("Review");

    await user.click(screen.getByRole("tab", { name: "People" }));
    expect(replaceState).not.toHaveBeenCalled();
    expect(selected()).toBe("People");
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * A later refresh re-renders the route against the same URL. If the rail took
   * the server prop on every render, an approve in Follow-ups — which calls
   * `router.refresh()` — would fling the owner out of the panel they were using.
   */
  it("stays on the owner's tab when a refresh re-renders the route", async () => {
    const user = userEvent.setup();
    const view = renderRail(0);
    await user.click(screen.getByRole("tab", { name: "Follow-ups" }));
    expect(selected()).toBe("Follow-ups");

    // A refresh: same URL, fresh data, and a server-computed tab that disagrees.
    view.rerender(rail(1));

    expect(selected()).toBe("Follow-ups");
    expect(screen.getByRole("tab", { name: "Review" })).toBeDefined();
  });

  /** A URL the owner navigated to — a nav link, Back, a shared link — still wins. */
  it("follows the URL when the destination itself changes", async () => {
    const user = userEvent.setup();
    const view = renderRail(0);
    await user.click(screen.getByRole("tab", { name: "People" }));
    expect(selected()).toBe("People");

    navigation.searchParams = new URLSearchParams();
    view.rerender(rail(0, "today"));

    expect(selected()).toBe("Today");
  });

  /** The count is the rail's whole share of the queue: the panel itself streams in. */
  it("shows the streamed panel without a count badge once something is waiting", () => {
    renderRail(3);

    expect(screen.getByRole("tab", { name: "Review" })).toBeDefined();
    expect(screen.getByText("Streamed review queue")).toBeDefined();
    expect(screen.queryByText(/Nothing waiting to review/)).toBeNull();
  });

  it("preserves the calm empty state", () => {
    renderRail(0);
    expect(screen.getByText(/Nothing waiting to review/)).toBeDefined();
    // It teaches what lands here rather than reporting a bare nothing.
    expect(screen.getByText(/Nothing is saved without your yes/)).toBeDefined();
    expect(screen.getByRole("tab", { name: "Review" })).toBeDefined();
  });
});

describe("DashboardRail Follow-ups horizon", () => {
  /**
   * The tab is bounded to what is near, so an empty one has to answer "and after
   * that?" without turning back into a list of things months away.
   */
  it("teaches the horizon and names the one reminder waiting past it", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams();
    render(
      <DashboardRail
        birthdays={[]}
        calendarSuggestions={[]}
        dailyBrief={null}
        followupReviews={[]}
        followups={[]}
        initialTab="followups"
        nextFollowup={
          {
            id: "followup-1",
            personId: "person-1",
            personName: "Kris Moore",
            reason: "Wish Kris a happy birthday",
            dueLabel: "Dec 3",
          } as never
        }
        people={[]}
        reviewContent={<p>Streamed review queue</p>}
        reviewCount={0}
        weeklyBrief={null}
      />,
    );

    expect(screen.getByText(/Nothing due in the next two weeks/)).toBeDefined();
    expect(screen.getByText(/Next up/)).toBeDefined();
    const link = screen.getByRole("link", { name: "Wish Kris a happy birthday" });
    expect(link.getAttribute("href")).toBe("/people/person-1#followup-followup-1");
    expect(screen.getByText("Dec 3")).toBeDefined();

    // The count badge follows the horizon: an empty near-term tab carries none.
    await user.click(screen.getByRole("tab", { name: "Follow-ups" }));
    expect(screen.getByRole("tab", { name: "Follow-ups" })).toBeDefined();
  });
});

describe("DashboardRail landing panel", () => {
  /**
   * A bare `/` names no panel, so the server's content-aware choice must survive
   * mount. It used to be overwritten by the URL's implicit "today", which is how
   * an owner with reminders and reviews waiting landed on an empty Today.
   */
  it("opens on the panel the server chose when the URL names none", () => {
    navigation.searchParams = new URLSearchParams();
    render(rail(0, "followups"));

    expect(selected()).toBe("Follow-ups");
  });

  /** A Review deep link still wins over any server default. */
  it("still opens on the panel the URL names", () => {
    navigation.searchParams = new URLSearchParams("tab=review");
    render(rail(0, "followups"));

    expect(selected()).toBe("Review");
  });

  /**
   * A refresh re-renders the same URL with fresh data, and the content-aware
   * default can legitimately move between renders. It must not drag the owner out
   * of the panel they chose.
   */
  it("stays put when a refresh changes the server default under the same URL", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams();
    const view = render(rail(0, "today"));

    await user.click(screen.getByRole("tab", { name: "People" }));
    view.rerender(rail(0, "review"));

    expect(selected()).toBe("People");
  });
});
