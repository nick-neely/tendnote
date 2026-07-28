// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewQueue, ReviewQueueItem } from "@/lib/review-queue";
import { fireEvent, render, screen, userEvent, waitFor, within } from "@/test/dom";
import { DashboardRail } from "./dashboard-rail";

const replace = vi.fn();
const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
  useSearchParams: () => navigation.searchParams,
}));

type MockActionReview = { action: { id: string; title: string } };
type MockActionCardProps = {
  review: MockActionReview;
  onResolve: (id: string) => void;
  onUpdate: (review: MockActionReview) => void;
};
type MockAssetCardProps = {
  review: { groupId: string; asset: { name: string } };
  onResolve: (id: string) => void;
  onUpdate: (review: MockAssetCardProps["review"]) => void;
};

vi.mock("@/app/actions/memory-review", () => ({
  dismissSuggestedMemoryAction: vi.fn().mockResolvedValue({ ok: true, view: undefined }),
  saveSuggestedMemoryAction: vi.fn().mockResolvedValue({ ok: true, view: undefined }),
}));
vi.mock("@/app/actions/conversational-capture", () => ({
  addCapturePersonAction: vi.fn(),
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
vi.mock("@/components/suggested-general-action-review", () => ({
  SuggestedGeneralActionReviewCard: ({ review, onResolve, onUpdate }: MockActionCardProps) => (
    <article data-testid={`action-${review.action.id}`}>
      {review.action.title}
      <button
        onClick={() => onUpdate({ ...review, action: { ...review.action, title: "Edited" } })}
        type="button"
      >
        Edit action
      </button>
      <button onClick={() => onResolve(review.action.id)} type="button">
        Resolve action
      </button>
    </article>
  ),
}));
vi.mock("@/components/asset-review-group-card", () => ({
  AssetReviewGroupCard: ({ review, onResolve, onUpdate }: MockAssetCardProps) => (
    <article data-testid={`asset-${review.groupId}`}>
      {review.asset.name}
      <button
        onClick={() => onUpdate({ ...review, asset: { name: "Existing boiler" } })}
        type="button"
      >
        Link asset
      </button>
      <button onClick={() => onResolve(review.groupId)} type="button">
        Resolve asset
      </button>
    </article>
  ),
}));

function queueItem(family: ReviewQueueItem["family"], id: string): ReviewQueueItem {
  if (family === "suggested-memory") {
    return {
      family,
      id,
      review: {
        memory: { id, personId: "person-1", content: "Memory content" },
        personName: "Avery",
      },
    } as ReviewQueueItem;
  }
  if (family === "suggested-general-action") {
    return {
      family,
      id,
      review: { action: { id, title: "Action title" } },
    } as ReviewQueueItem;
  }
  return {
    family,
    id,
    review: { groupId: id, asset: { name: "Boiler" } },
  } as ReviewQueueItem;
}

function rail(reviewQueue: ReviewQueue, initialTab: "today" | "review" = "review") {
  return (
    <DashboardRail
      birthdays={[]}
      calendarSuggestions={[]}
      dailyBrief={null}
      followupReviews={[]}
      followups={[]}
      initialTab={initialTab}
      people={[]}
      reviewQueue={reviewQueue}
      weeklyBrief={null}
    />
  );
}

/** The rail always mounts on the panel the current URL names, as it does in the app. */
function renderRail(reviewQueue: ReviewQueue, initialTab: "today" | "review" = "review") {
  navigation.searchParams = new URLSearchParams(initialTab === "review" ? "tab=review" : "");
  return render(rail(reviewQueue, initialTab));
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
    renderRail({ count: 0, failures: [], items: [] });

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
    const view = renderRail({ count: 0, failures: [], items: [] });
    await user.click(screen.getByRole("tab", { name: "Follow-ups" }));
    expect(selected()).toBe("Follow-ups");

    // A refresh: same URL, fresh data, and a server-computed tab that disagrees.
    view.rerender(rail({ count: 1, failures: [], items: [queueItem("suggested-memory", "m-1")] }));

    expect(selected()).toBe("Follow-ups");
    expect(screen.getByRole("tab", { name: "Review1" })).toBeDefined();
  });

  /** A URL the owner navigated to — a nav link, Back, a shared link — still wins. */
  it("follows the URL when the destination itself changes", async () => {
    const user = userEvent.setup();
    const view = renderRail({ count: 0, failures: [], items: [] });
    await user.click(screen.getByRole("tab", { name: "People" }));
    expect(selected()).toBe("People");

    navigation.searchParams = new URLSearchParams();
    view.rerender(rail({ count: 0, failures: [], items: [] }, "today"));

    expect(selected()).toBe("Today");
  });

  it("renders one mixed queue in collection order and counts Asset groups once", () => {
    renderRail({
      items: [
        queueItem("suggested-memory", "memory-1"),
        queueItem("suggested-general-action", "action-1"),
        queueItem("asset-review-group", "group-1"),
      ],
      count: 3,
      failures: [],
    });

    expect(screen.getByRole("tab", { name: "Review3" })).toBeDefined();
    const list = screen.getByRole("list", { name: "Review queue" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.dataset.queueFamily),
    ).toEqual(["suggested-memory", "suggested-general-action", "asset-review-group"]);
  });

  it("updates and resolves only the action selected through its family callback", () => {
    renderRail({
      items: [
        queueItem("suggested-memory", "shared-id"),
        queueItem("suggested-general-action", "shared-id"),
        queueItem("asset-review-group", "group-1"),
      ],
      count: 3,
      failures: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    expect(screen.getByText("Edited")).toBeDefined();
    expect(screen.getByText("Memory content")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Resolve action" }));
    expect(screen.queryByTestId("action-shared-id")).toBeNull();
    expect(screen.getByText("Memory content")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Review2" })).toBeDefined();
  });

  it("updates only the grouped Asset selected when family ids collide", () => {
    renderRail({
      items: [
        queueItem("suggested-memory", "shared-id"),
        queueItem("suggested-general-action", "shared-id"),
        queueItem("asset-review-group", "shared-id"),
      ],
      count: 3,
      failures: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Link asset" }));

    expect(screen.getByTestId("asset-shared-id").textContent).toContain("Existing boiler");
    expect(screen.getByTestId("action-shared-id").textContent).toContain("Action title");
    expect(screen.getByText("Memory content")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Review3" })).toBeDefined();
  });

  it("routes memory and grouped Asset resolution through their discriminated identities", async () => {
    renderRail({
      items: [
        queueItem("suggested-memory", "shared-id"),
        queueItem("suggested-general-action", "shared-id"),
        queueItem("asset-review-group", "shared-id"),
      ],
      count: 3,
      failures: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve asset" }));
    expect(screen.queryByTestId("asset-shared-id")).toBeNull();
    expect(screen.getByTestId("action-shared-id")).toBeDefined();
    expect(screen.getByText("Memory content")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Save suggestion about Avery" }));
    await waitFor(() => expect(screen.queryByText("Memory content")).toBeNull());
    expect(screen.getByTestId("action-shared-id")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Review1" })).toBeDefined();
  });

  it("preserves the calm empty state", () => {
    renderRail({ items: [], count: 0, failures: ["suggested-memory"] });
    expect(screen.getByText(/Nothing waiting to review/)).toBeDefined();
    expect(screen.getByRole("tab", { name: "Review" })).toBeDefined();
  });
});
