// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the grouped Asset Review card (#198): batch accept and
 * dismiss, per-detail accept/dismiss, inline edit-before-accept for the asset
 * and its details, and the duplicate link-to-existing prompt. Every mutation
 * flows through the asset-review server actions; the returned view either
 * updates the card in place or resolves it out of the queue.
 */

const acceptAssetReviewGroupAction = vi.fn();
const acceptSuggestedAssetAction = vi.fn();
const acceptSuggestedAssetMemoryAction = vi.fn();
const dismissAssetReviewGroupAction = vi.fn();
const dismissSuggestedAssetMemoryAction = vi.fn();
const editSuggestedAssetAction = vi.fn();
const editSuggestedAssetMemoryAction = vi.fn();
const linkAssetReviewGroupAction = vi.fn();

vi.mock("@/app/actions/asset-review", () => ({
  acceptAssetReviewGroupAction: (...args: unknown[]) => acceptAssetReviewGroupAction(...args),
  acceptSuggestedAssetAction: (...args: unknown[]) => acceptSuggestedAssetAction(...args),
  acceptSuggestedAssetMemoryAction: (...args: unknown[]) =>
    acceptSuggestedAssetMemoryAction(...args),
  dismissAssetReviewGroupAction: (...args: unknown[]) => dismissAssetReviewGroupAction(...args),
  dismissSuggestedAssetMemoryAction: (...args: unknown[]) =>
    dismissSuggestedAssetMemoryAction(...args),
  editSuggestedAssetAction: (...args: unknown[]) => editSuggestedAssetAction(...args),
  editSuggestedAssetMemoryAction: (...args: unknown[]) => editSuggestedAssetMemoryAction(...args),
  linkAssetReviewGroupAction: (...args: unknown[]) => linkAssetReviewGroupAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetReviewGroupCard } from "./asset-review-group-card";

function reviewFixture(overrides: Partial<AssetReviewGroupView> = {}): AssetReviewGroupView {
  return {
    groupId: "group-1",
    asset: {
      id: "asset-1",
      name: "Fridge filter",
      kind: "appliance",
      kindLabel: "Appliance",
      scope: "private",
      visibilityLabel: "Only me",
      pending: true,
    },
    memories: [
      {
        id: "memory-1",
        label: "Filter model",
        value: { type: "text", text: "EDR3RXD1" },
        valueLabel: "EDR3RXD1",
        notes: null,
      },
      {
        id: "memory-2",
        label: "Purchase date",
        value: { type: "date", date: "2026-03-14" },
        valueLabel: "Mar 14, 2026",
        notes: null,
      },
      {
        id: "memory-3",
        label: "Paid",
        value: { type: "amount", amount: 42.99, currency: "USD" },
        valueLabel: "$42.99",
        notes: null,
      },
    ],
    duplicates: [{ id: "asset-9", name: "Refrigerator water filter", kindLabel: "Appliance" }],
    source: {
      id: "source-1",
      content: "New fridge filter is EDR3RXD1, bought Mar 14.",
      sourceType: "manual",
      capturedAt: "2026-07-01T12:00:00.000Z",
    },
    pendingCount: 4,
    ...overrides,
  };
}

const resolved = (overrides: Partial<AssetReviewGroupView> = {}) =>
  reviewFixture({ memories: [], duplicates: [], pendingCount: 0, ...overrides });

describe("AssetReviewGroupCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the whole group: asset, details, duplicate prompt, and grounding", () => {
    render(<AssetReviewGroupCard onResolve={vi.fn()} review={reviewFixture()} />);

    expect(screen.getByText("Suggested asset")).toBeDefined();
    expect(screen.getByText("Fridge filter")).toBeDefined();
    expect(screen.getByText("EDR3RXD1")).toBeDefined();
    expect(screen.getByText("Mar 14, 2026")).toBeDefined();
    expect(screen.getByRole("button", { name: /Link to Refrigerator water filter/ })).toBeDefined();
    expect(screen.getByText(/New fridge filter is EDR3RXD1/)).toBeDefined();
  });

  it("batch-accepts the group and resolves the card", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    acceptAssetReviewGroupAction.mockResolvedValue(resolved());
    render(<AssetReviewGroupCard onResolve={onResolve} review={reviewFixture()} />);

    await user.click(screen.getByRole("button", { name: /Accept all/ }));

    await waitFor(() =>
      expect(acceptAssetReviewGroupAction).toHaveBeenCalledWith({ groupId: "group-1" }),
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("group-1"));
    expect(refresh).toHaveBeenCalled();
  });

  it("batch-dismisses without guilt", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    dismissAssetReviewGroupAction.mockResolvedValue(resolved());
    render(<AssetReviewGroupCard onResolve={onResolve} review={reviewFixture()} />);

    await user.click(screen.getByRole("button", { name: /Dismiss all/ }));

    await waitFor(() =>
      expect(dismissAssetReviewGroupAction).toHaveBeenCalledWith({ groupId: "group-1" }),
    );
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("group-1"));
  });

  it("links to an existing asset instead of creating a near-duplicate", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const linkedView = reviewFixture({
      asset: {
        id: "asset-9",
        name: "Refrigerator water filter",
        kind: "appliance",
        kindLabel: "Appliance",
        scope: "private",
        visibilityLabel: "Only me",
        pending: false,
      },
      duplicates: [],
      pendingCount: 2,
    });
    linkAssetReviewGroupAction.mockResolvedValue(linkedView);
    render(
      <AssetReviewGroupCard onResolve={vi.fn()} onUpdate={onUpdate} review={reviewFixture()} />,
    );

    await user.click(screen.getByRole("button", { name: /Link to Refrigerator water filter/ }));

    await waitFor(() =>
      expect(linkAssetReviewGroupAction).toHaveBeenCalledWith({
        groupId: "group-1",
        targetAssetId: "asset-9",
      }),
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(linkedView));
  });

  it("edits a detail before accepting it", async () => {
    const user = userEvent.setup();
    acceptSuggestedAssetMemoryAction.mockResolvedValue(reviewFixture({ pendingCount: 2 }));
    render(
      <AssetReviewGroupCard onResolve={vi.fn()} onUpdate={vi.fn()} review={reviewFixture()} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit detail: Filter model" }));
    const valueInput = screen.getByRole("textbox", { name: "Value" });
    await user.clear(valueInput);
    await user.type(valueInput, "EDR4RXD1");
    // Accept inside edit mode carries the correction with it.
    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(acceptSuggestedAssetMemoryAction).toHaveBeenCalledWith({
        memoryId: "memory-1",
        edit: { value: { type: "text", text: "EDR4RXD1" } },
      }),
    );
  });

  it("refuses to accept a detail while its amount draft is invalid", async () => {
    const user = userEvent.setup();
    render(
      <AssetReviewGroupCard onResolve={vi.fn()} onUpdate={vi.fn()} review={reviewFixture()} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit detail: Paid" }));
    const amountInput = screen.getByRole("spinbutton", { name: /Amount/ });
    await user.clear(amountInput);
    await user.type(amountInput, "-5");

    // Invalid input blocks BOTH submit paths — accepting must never ship the
    // original value while the input shows the rejected text — and says why.
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid amount.");
    const accept = screen.getByRole("button", { name: /^Accept$/ });
    expect(accept.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Apply edit" }).hasAttribute("disabled")).toBe(true);
    expect(acceptSuggestedAssetMemoryAction).not.toHaveBeenCalled();
  });

  it("dismisses one detail without touching its siblings", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const remaining = reviewFixture({
      memories: [reviewFixture().memories[1] as AssetReviewGroupView["memories"][number]],
      pendingCount: 2,
    });
    dismissSuggestedAssetMemoryAction.mockResolvedValue(remaining);
    render(
      <AssetReviewGroupCard onResolve={vi.fn()} onUpdate={onUpdate} review={reviewFixture()} />,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss detail: Filter model" }));

    await waitFor(() =>
      expect(dismissSuggestedAssetMemoryAction).toHaveBeenCalledWith({ memoryId: "memory-1" }),
    );
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(remaining));
  });

  it("corrects the suggested asset's name before accepting it", async () => {
    const user = userEvent.setup();
    acceptSuggestedAssetAction.mockResolvedValue(reviewFixture({ pendingCount: 2 }));
    render(
      <AssetReviewGroupCard onResolve={vi.fn()} onUpdate={vi.fn()} review={reviewFixture()} />,
    );

    await user.click(screen.getByRole("button", { name: "Edit suggested asset: Fridge filter" }));
    const nameInput = screen.getByRole("textbox", { name: "Asset name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Refrigerator water filter");
    await user.click(screen.getByRole("button", { name: /Accept asset/ }));

    await waitFor(() =>
      expect(acceptSuggestedAssetAction).toHaveBeenCalledWith({
        assetId: "asset-1",
        edit: { name: "Refrigerator water filter" },
      }),
    );
  });

  it("anchors an existing asset as a quiet deep link, no duplicate prompt", () => {
    const view = reviewFixture({
      asset: {
        id: "asset-9",
        name: "Refrigerator water filter",
        kind: "appliance",
        kindLabel: "Appliance",
        scope: "private",
        visibilityLabel: "Only me",
        pending: false,
      },
      duplicates: [],
      memories: [reviewFixture().memories[0] as AssetReviewGroupView["memories"][number]],
      pendingCount: 1,
    });
    render(<AssetReviewGroupCard onResolve={vi.fn()} review={view} />);

    const link = screen.getByRole("link", { name: "Refrigerator water filter" });
    expect(link.getAttribute("href")).toBe("/assets/asset-9");
    expect(screen.queryByRole("button", { name: /Link to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept asset/ })).toBeNull();
    // A single pending member drops the "all" from the batch labels.
    expect(screen.getByRole("button", { name: /^Accept$/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Dismiss$/ })).toBeDefined();
  });
});
