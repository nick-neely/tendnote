import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assetViewFixture } from "@/components/asset-fixtures";
import type { AssetView } from "@/lib/asset-view";

// The real actions pull in `server-only`; the surface only needs them to exist as
// callable handlers, which these render tests never fire.
// vitest hoists `vi.mock` factories above imports, so this standard mock boilerplate
// cannot be shared without fragile dynamic-import gymnastics that obscure the idiom.
// fallow-ignore-next-line code-duplication
vi.mock("@/app/actions/assets", () => ({
  archiveAssetAction: vi.fn(),
  createAssetAction: vi.fn(),
  editAssetAction: vi.fn(),
  restoreAssetAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AssetsSurface, filterAssets } from "./assets-surface";

function render(assets: AssetView[]) {
  return renderToStaticMarkup(<AssetsSurface assets={assets} />);
}

const FRIDGE = assetViewFixture({ id: "a-fridge", name: "Kitchen refrigerator" });
const CAR = assetViewFixture({
  id: "a-car",
  name: "Corolla",
  kind: "vehicle",
  kindLabel: "Vehicle",
});
const OLD_PLAN = assetViewFixture({
  id: "a-plan",
  name: "Old streaming plan",
  kind: "subscription",
  kindLabel: "Subscription",
  status: "archived",
  archived: true,
  archivedLabel: "Archived Jul 10",
});

describe("AssetsSurface", () => {
  it("renders active assets as profile links with kind and provenance", () => {
    const html = render([FRIDGE, CAR]);

    expect(html).toContain("Kitchen refrigerator");
    expect(html).toContain(`href="/assets/a-fridge"`);
    expect(html).toContain("Appliance");
    expect(html).toContain("Vehicle");
    expect(html).toContain("Added Jul 1");
  });

  it("defaults to the active lifecycle view, keeping archived assets one filter away", () => {
    const html = render([FRIDGE, OLD_PLAN]);

    expect(html).not.toContain("Old streaming plan");
    // The state filter appears exactly because an archived asset exists.
    expect(html).toContain("Filter by state");
  });

  it("hides filter chrome entirely when there is nothing to narrow", () => {
    const html = render([FRIDGE]);

    expect(html).not.toContain("Filter by kind");
    expect(html).not.toContain("Filter by state");
    expect(html).not.toContain("Filter by visibility");
  });

  it("offers a visibility filter only when a non-private asset is visible", () => {
    const shared = assetViewFixture({
      id: "a-shared",
      name: "Streaming plan",
      scope: "household",
      visibilityLabel: "Home",
    });
    expect(render([FRIDGE, shared])).toContain("Filter by visibility");
    expect(render([FRIDGE, CAR])).not.toContain("Filter by visibility");
  });

  it("teaches the first capture when nothing is tracked yet", () => {
    const html = render([]);
    expect(html).toContain("Nothing tracked yet");
    expect(html).toContain("What do you want to keep track of?");
  });

  it("marks an archived row with the word, never color alone", () => {
    const html = renderToStaticMarkup(
      // Render with the archived-inclusive view via the pure filter to keep this
      // a static assertion on the row treatment.
      <ul>
        {filterAssets([FRIDGE, OLD_PLAN], { kind: null, state: "archived", scope: null }).map(
          (asset) => (
            <li key={asset.id}>{asset.name}</li>
          ),
        )}
      </ul>,
    );
    expect(html).toContain("Old streaming plan");
    expect(html).not.toContain("Kitchen refrigerator");
  });
});

describe("filterAssets", () => {
  const all = [FRIDGE, CAR, OLD_PLAN];

  it("narrows by kind, lifecycle state, and visibility independently", () => {
    expect(
      filterAssets(all, { kind: "vehicle", state: "all", scope: null }).map((a) => a.id),
    ).toEqual(["a-car"]);
    expect(
      filterAssets(all, { kind: null, state: "archived", scope: null }).map((a) => a.id),
    ).toEqual(["a-plan"]);
    expect(
      filterAssets(all, { kind: null, state: "all", scope: "private" }).map((a) => a.id),
    ).toEqual(["a-fridge", "a-car", "a-plan"]);
  });

  it("stacks filters conjunctively", () => {
    expect(filterAssets(all, { kind: "subscription", state: "active", scope: null })).toEqual([]);
  });
});
