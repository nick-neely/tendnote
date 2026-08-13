// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetViewFixture } from "@/components/asset-fixtures";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the Assets surface filters (#197): drives the real user
 * path - opening the "Filters and sort" disclosure and choosing kind/state/
 * visibility - and asserts the client filter narrows the rendered ledger in place,
 * the collapsed summary keeps the selection visible, and the clear affordances
 * restore it.
 *
 * Every filter now sits behind one collapsed control on every viewport, so these
 * tests open it first. That is also the honest narrow-viewport check (ADR 0161):
 * jsdom applies no media queries, so it renders the mobile-first *base* layer -
 * asserting the capture form and every filter group are reachable and operable
 * there proves the surface's controls survive a phone width.
 *
 * Single-select rows are Radix `ToggleGroup`s, which carry radiogroup/radio
 * semantics; the queries below use those roles rather than pressed buttons.
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

const navigation = {
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/assets",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
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
  visibilityLabel: "Whole household",
});

beforeEach(() => {
  navigation.replace.mockClear();
  navigation.searchParams = new URLSearchParams();
});

/** Opens the collapsed filter panel and returns its trigger. */
async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: /Filters and sort/ });
  await user.click(trigger);
  return trigger;
}

describe("AssetsSurface filters (DOM)", () => {
  it("names a household-scoped asset Whole household on the row itself", () => {
    render(
      <AssetsSurface
        assets={[
          assetViewFixture({
            id: "a-shared",
            name: "Streaming plan",
            scope: "household",
            visibilityLabel: "Whole household",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Whole household")).toBeDefined();
  });

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

    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Has due action" }));
    await waitFor(() => expect(screen.getByText("Boiler")).toBeDefined());
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(browse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ due: "with_due_action", offset: undefined }),
    );

    // `findByRole`, not `getByRole`: the button reads "Loading…" for as long as the
    // browse transition is pending, and that flag clears a commit after the rows land.
    await user.click(await screen.findByRole("button", { name: "Load more assets" }));
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

    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Vehicle" }));
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(screen.getByText("Corolla")).toBeDefined();

    await user.click(screen.getByRole("radio", { name: "All kinds" }));
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("keeps archived assets out of the default view and reveals them via the state chips", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, ARCHIVED_PLAN]} />);

    expect(screen.queryByText("Old streaming plan")).toBeNull();

    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Archived" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Everything" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("narrows by visibility scope", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, ARCHIVED_PLAN]} />);

    // Include archived so the household-scoped plan is in view first.
    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Everything" }));
    await user.click(screen.getByRole("radio", { name: "Whole household" }));
    expect(screen.getByText("Old streaming plan")).toBeDefined();
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
  });

  it("offers a visibility row only when a non-private asset is in the list", async () => {
    const user = userEvent.setup();
    const shared = assetViewFixture({
      id: "a-shared",
      name: "Streaming plan",
      scope: "household",
      visibilityLabel: "Whole household",
    });
    const { unmount } = render(<AssetsSurface assets={[FRIDGE, shared]} />);
    await openFilters(user);
    expect(screen.getByRole("radiogroup", { name: "Visibility" })).toBeDefined();
    unmount();

    render(<AssetsSurface assets={[FRIDGE, CAR]} />);
    await openFilters(user);
    expect(screen.queryByRole("radiogroup", { name: "Visibility" })).toBeNull();
  });

  it("offers a one-click reset from a filtered-empty view, keeping the selected kind's chip", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    // Vehicle + Archived matches nothing — the empty state must offer a reset,
    // and the selected Vehicle chip must survive the state switch so the
    // selection never becomes invisible.
    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Vehicle" }));
    await user.click(screen.getByRole("radio", { name: "Archived" }));
    expect(screen.queryByText("Kitchen refrigerator")).toBeNull();
    expect(screen.getByRole("radio", { name: "Vehicle" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });

  it("offers no kind chip that would dead-end the current lifecycle view", async () => {
    // ARCHIVED_PLAN is the only subscription and it is archived: from the default
    // Active view a "Subscription" chip could only produce an empty ledger, so it
    // must not be offered until the archived view is in play.
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);
    await openFilters(user);
    expect(screen.queryByRole("radio", { name: "Subscription" })).toBeNull();
  });

  it("keeps capture and every filter group behind one collapsed control", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    expect(
      screen.getByRole("textbox", { name: "What do you want to keep track of?" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Add asset/ })).toBeDefined();

    // Collapsed by default on every viewport: nothing but the one control shows.
    expect(screen.queryByRole("radiogroup", { name: "Kind" })).toBeNull();
    const trigger = screen.getByRole("button", { name: /Filters and sort/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "Kind" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "State" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "Visibility" })).toBeDefined();
    // Rows are real links into the Asset Profile.
    const row = screen.getByRole("link", { name: /Kitchen refrigerator/ });
    expect(row.getAttribute("href")).toBe("/assets/a-fridge");
  });

  it("summarises the selection beside the collapsed control and clears it in one move", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    const trigger = await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Vehicle" }));
    await user.click(trigger);

    // Collapsed, but the state is still on the page in plain words.
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const summary = screen.getByRole("list", { name: "Filters in force" });
    expect(summary.textContent).toContain("Vehicle");

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByRole("list", { name: "Filters in force" })).toBeNull();
    expect(screen.getByText("Kitchen refrigerator")).toBeDefined();
  });
});

describe("AssetsSurface filter persistence (DOM)", () => {
  it("restores the selection the URL carries and writes changes back to it", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams("kind=vehicle");
    render(<AssetsSurface assets={[FRIDGE, CAR]} />);

    // A reload lands here: the ledger is already narrowed, before any interaction.
    await waitFor(() => expect(screen.queryByText("Kitchen refrigerator")).toBeNull());
    expect(screen.getByText("Corolla")).toBeDefined();
    expect(screen.getByRole("list", { name: "Filters in force" }).textContent).toContain("Vehicle");
    // Replaying the URL must not write it back.
    expect(navigation.replace).not.toHaveBeenCalled();

    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "All kinds" }));
    expect(navigation.replace).toHaveBeenCalledWith("/assets", { scroll: false });
  });

  it("keeps default values out of the URL and names only what is narrowed", async () => {
    const user = userEvent.setup();
    render(<AssetsSurface assets={[FRIDGE, CAR, ARCHIVED_PLAN]} />);

    await openFilters(user);
    await user.click(screen.getByRole("radio", { name: "Archived" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/assets?state=archived", {
      scroll: false,
    });
  });
});
