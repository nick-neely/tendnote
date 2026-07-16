// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewQueue, ReviewQueueItem } from "@/lib/review-queue";
import { fireEvent, render, screen, waitFor, within } from "@/test/dom";
import { DashboardRail } from "./dashboard-rail";

type MockActionReview = { action: { id: string; title: string } };
type MockActionCardProps = {
  review: MockActionReview;
  onResolve: (id: string) => void;
  onUpdate: (review: MockActionReview) => void;
};
type MockAssetCardProps = {
  review: { groupId: string; asset: { name: string } };
  onResolve: (id: string) => void;
};

vi.mock("@/app/actions/memory-review", () => ({
  dismissSuggestedMemoryAction: vi.fn(),
  saveSuggestedMemoryAction: vi.fn(),
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
  AssetReviewGroupCard: ({ review, onResolve }: MockAssetCardProps) => (
    <article data-testid={`asset-${review.groupId}`}>
      {review.asset.name}
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

function renderRail(reviewQueue: ReviewQueue) {
  return render(
    <DashboardRail
      birthdays={[]}
      calendarSuggestions={[]}
      dailyBrief={null}
      followupReviews={[]}
      followups={[]}
      initialTab="review"
      people={[]}
      reviewQueue={reviewQueue}
      weeklyBrief={null}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardRail Review Queue", () => {
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
