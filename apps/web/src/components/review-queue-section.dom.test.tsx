// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ReviewQueueItem } from "@/lib/review-queue";
import { fireEvent, render, screen, waitFor, within } from "@/test/dom";
import { ReviewQueueFamilySection } from "./review-queue-section";

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
  restoreDismissedSuggestedMemoryAction: vi.fn(),
  saveSuggestedMemoryAction: vi.fn().mockResolvedValue({ ok: true, view: undefined }),
}));
vi.mock("@/app/actions/conversational-capture", () => ({
  addCapturePersonAction: vi.fn(),
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

function renderSection(items: ReviewQueueItem[]) {
  return render(<ReviewQueueFamilySection heading="Needs review" initialItems={items} />);
}

/**
 * The streamed Review panel: one section per family, each owning its own
 * optimistic collection. Ids are only unique within a family, so every callback
 * has to route by the discriminated `{ family, id }` identity - resolving an
 * action once took the memory and the Asset group sharing its id with it.
 */
describe("ReviewQueueFamilySection", () => {
  it("renders a mixed collection in order", () => {
    renderSection([
      queueItem("suggested-memory", "memory-1"),
      queueItem("suggested-general-action", "action-1"),
      queueItem("asset-review-group", "group-1"),
    ]);

    const list = screen.getByRole("list", { name: "Review queue" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.dataset.queueFamily),
    ).toEqual(["suggested-memory", "suggested-general-action", "asset-review-group"]);
  });

  it("updates and resolves only the action selected through its family callback", () => {
    renderSection([
      queueItem("suggested-memory", "shared-id"),
      queueItem("suggested-general-action", "shared-id"),
      queueItem("asset-review-group", "group-1"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Edit action" }));
    expect(screen.getByText("Edited")).toBeDefined();
    expect(screen.getByText("Memory content")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Resolve action" }));
    expect(screen.queryByTestId("action-shared-id")).toBeNull();
    expect(screen.getByText("Memory content")).toBeDefined();
    expect(screen.getByTestId("asset-group-1")).toBeDefined();
  });

  it("updates only the grouped Asset selected when family ids collide", () => {
    renderSection([
      queueItem("suggested-memory", "shared-id"),
      queueItem("suggested-general-action", "shared-id"),
      queueItem("asset-review-group", "shared-id"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Link asset" }));

    expect(screen.getByTestId("asset-shared-id").textContent).toContain("Existing boiler");
    expect(screen.getByTestId("action-shared-id").textContent).toContain("Action title");
    expect(screen.getByText("Memory content")).toBeDefined();
  });

  it("routes memory and grouped Asset resolution through their discriminated identities", async () => {
    renderSection([
      queueItem("suggested-memory", "shared-id"),
      queueItem("suggested-general-action", "shared-id"),
      queueItem("asset-review-group", "shared-id"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Resolve asset" }));
    expect(screen.queryByTestId("asset-shared-id")).toBeNull();
    expect(screen.getByTestId("action-shared-id")).toBeDefined();
    expect(screen.getByText("Memory content")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Save suggestion about Avery" }));
    await waitFor(() => expect(screen.queryByText("Memory content")).toBeNull());
    expect(screen.getByTestId("action-shared-id")).toBeDefined();
  });
});
