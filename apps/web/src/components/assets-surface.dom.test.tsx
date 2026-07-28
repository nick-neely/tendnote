// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { assetViewFixture } from "@/components/asset-fixtures";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the Assets surface filters (#197): drives the real user
 * path — clicking kind/state/visibility chips — and asserts the client filter
 * narrows the rendered ledger in place and the clear affordances restore it.
 *
 * Also carries the honest narrow-viewport check (ADR 0161): jsdom applies no
 * media queries, so it renders the mobile-first *base* layer — asserting the
 * capture form and every filter group are in the document and operable there
 * proves the surface's controls stay reachable at a phone width.
 */

// vitest hoists `vi.mock` factories above imports, so this standard mock boilerplate
// cannot be shared without fragile dynamic-import gymnastics that obscure the idiom.
// fallow-ignore-next-line code-duplication
vi.mock("@/app/actions/assets", () => ({
  archiveAssetAction: vi.fn(),
  createAssetAction: vi.fn(),
  editAssetAction: vi.fn(),
  restoreAssetAction: vi.fn(),
  browseAssetsAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetsSurface } from "./assets-surface";

const FRIDGE = assetViewFixture({ id: "a-fridge", name: "Kitchen refrigerator" });
const CAR = assetViewFixture({
  id: "a-car",
  name: "Corolla",
  kind: "vehicle",
  kindLabel: "Vehicle",
});
const ARCHIVED_PLAN = assetViewFixture({
  id: "a-plan",
  name: "Old streaming plan",
  kind: "subscription",
  kindLabel: "Subscription",
  status: "archived",
  archived: true,
  archivedLabel: "Archived Jul 10",
  scope: "household",
  visibilityLabel: "Home",
});

describe("AssetsSurface filters (DOM)", () => {
  it("surfaces review and due-action context with an incremental loading affordance", () => {
    render(
      <AssetsSurface
        assets={[
          assetViewFixture({
            id: "a-review",
            name: "Boiler",
            needsReview: true,
            nextDueActionLabel: "Due Sep 2",
            nextDueActionState: "upcoming",
          }),
        ]}
        nextOffset={24}
        reviewCount={2}
      />,
    );

    expect(screen.getByRole("link", { name: /2 asset reviews/i })).toBeDefined();
    expect(screen.getByText("Needs review")).toBeDefined();
    expect(screen.getByText("Due Sep 2")).toBeDefined();
    expect(screen.getByRole("button", { name: "Load more assets" })).toBeDefined();
  });

  it("requests server-filtered results and appends the next bounded page", async () => {
    const user = userEvent.setup();
    const dueAsset = assetViewFixture({ id: "a-due", name: "Boiler" });
    const moreAsset = assetViewFixture({ id: "a-more", name: "Water softener" });
    const browse = vi
      .fn()
      .mockResolvedValueOnce({ assets: [dueAsset], reviewCount: 0, nextOffset: 24 })
      .mockResolvedValueOnce({ assets: [moreAsset], reviewCount: 0, nextOffset: null });
    render(<AssetsSurface assets={[FRIDGE]} browse={browse} nextOffset={24} />);

    await user.click(screen.getByRole("button", { name: "Has due action" }));
    await waitFor(() => expect(screen.getByText("Boiler")).toBeDefined());
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(browse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ due: "with_due_action", offset: undefined }),
    );

    await user.click(screen.getByRole("button", { name: "Load more assets" }));
    await waitFor(() => expect(screen.getByText("Water softener")).toBeDefined());
    expect(screen.getByText("Boiler")).toBeDefined();
    expect(browse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ due: "with_due_action", offset: 24 }),
    );
  });

  it("narrows the ledger by kind and restores it with the All chip", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR]} />);

    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
    expect(screen.getByText("Corolla")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Vehicle" }));
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(screen.getByText("Corolla")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "All kinds" }));
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("keeps archived assets out of the default view and reveals them via the state chips", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, ARCHIVED_PLAN]} />);

    expect(screen.queryByText("Old streaming plan")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Everything" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("narrows by visibility scope", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, ARCHIVED_PLAN]} />);

    // Include archived so the household-scoped plan is in view first.
    await user.click(screen.getByRole("button", { name: "Everything" }));
    await user.click(screen.getByRole("button", { name: "Whole household" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
  });

  it("offers a one-click reset from a filtered-empty view, keeping the selected kind's chip", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    // Vehicle + Archived matches nothing — the empty state must offer a reset,
    // and the selected Vehicle chip must survive the state switch so the
    // selection never becomes invisible.
    await user.click(screen.getByRole("button", { name: "Vehicle" }));
    await user.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(screen.getByRole("button", { name: "Vehicle" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Show everything active" }));
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("offers no kind chip that would dead-end the current lifecycle view", () => {
    // ARCHIVED_PLAN is the only subscription and it is archived: from the default
    // Active view a "Subscription" chip could only produce an empty ledger, so it
    // must not be offered until the archived view is in play.
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);
    expect(screen.queryByRole("button", { name: "Subscription" })).toBeNull();
  });

  it("keeps capture and every filter group reachable behind a compact mobile control", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    expect(
      screen.getByRole("textbox", { name: "What do you want to keep track of?" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Add asset/ })).toBeDefined();
    const filters = screen.getByRole("button", { name: /Filters and sort/ });
    expect(filters.getAttribute("aria-expanded")).toBe("false");
    await user.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "Filter by kind" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Filter by state" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Filter by visibility" })).toBeDefined();
    // Rows are real links into the Asset Profile.
    const row = screen.getByRole("link", { name: /Kitchen refrigerator/ });
    expect(row.getAttribute("href")).toBe("/assets/a-fridge");
  });
});
