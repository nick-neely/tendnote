// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AssetSearchPanel, type AssetSearchRunner } from "@/components/asset-search-panel";
import type { AssetSearchResultView } from "@/lib/asset-search-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

function result(overrides: Partial<AssetSearchResultView> = {}): AssetSearchResultView {
  return {
    key: "asset_memory:memory-1",
    recordKind: "asset_memory",
    recordId: "memory-1",
    assetId: "asset-1",
    assetName: "Refrigerator",
    assetKind: "appliance",
    archived: false,
    label: "Filter size",
    snippet: "Filter size: RPWFE",
    value: "RPWFE",
    matchKinds: ["structured"],
    trustLevel: "asset_fact",
    visibilityLabel: "Whole household",
    ...overrides,
  };
}

function renderPanel(results: AssetSearchResultView[]) {
  const search = vi.fn(async () => ({ results }));
  render(
    <AssetSearchPanel search={search}>
      <p>Browse list</p>
    </AssetSearchPanel>,
  );

  return { search };
}

describe("AssetSearchPanel", () => {
  it("browses until the user searches, then steps the list aside", async () => {
    const user = userEvent.setup();
    renderPanel([result()]);

    expect(screen.getByText("Browse list")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "RPWFE");

    await waitFor(() => {
      expect(screen.getByTestId("asset-search-results")).toBeTruthy();
    });
    expect(screen.queryByText("Browse list")).toBeNull();
  });

  it("shows the exact stored value as the answer, not buried in prose", async () => {
    const user = userEvent.setup();
    renderPanel([result()]);

    await user.type(
      screen.getByRole("searchbox", { name: /search your things/i }),
      "fridge filter",
    );

    await waitFor(() => {
      expect(screen.getByText("RPWFE")).toBeTruthy();
    });
    expect(screen.getByText("Filter size")).toBeTruthy();
  });

  it("groups exact hits apart from meaning-only ones, so the two claims never read alike", async () => {
    const user = userEvent.setup();
    renderPanel([
      result({ matchKinds: ["structured"] }),
      result({
        key: "asset:asset-2",
        recordKind: "asset",
        recordId: "asset-2",
        assetId: "asset-2",
        assetName: "Garage dehumidifier",
        label: "Garage dehumidifier",
        value: null,
        snippet: "Garage dehumidifier",
        matchKinds: ["semantic"],
        trustLevel: "asset_anchor",
      }),
    ]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "filter");

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Exact matches" })).toBeTruthy();
    });
    const related = screen.getByRole("region", { name: "Related" });
    // The fuzzy hit lives under "Related" and nowhere else; the exact one is not there.
    expect(related.textContent).toContain("Garage dehumidifier");
    expect(related.textContent).not.toContain("Refrigerator");
  });

  it("marks a structured hit at the value it certifies", async () => {
    const user = userEvent.setup();
    renderPanel([result({ matchKinds: ["structured"] })]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "RPWFE");

    await waitFor(() => {
      expect(screen.getByText("Exact value")).toBeTruthy();
    });
  });

  it("shows a failed query inline and offers a retry — it never takes the page down", async () => {
    const user = userEvent.setup();
    const search = vi
      .fn<AssetSearchRunner>()
      .mockRejectedValueOnce(new Error("malformed array literal"))
      .mockResolvedValue({ results: [result()] });

    render(
      <AssetSearchPanel search={search}>
        <p>Browse list</p>
      </AssetSearchPanel>,
    );

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "21-2100");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("didn't run");
    });

    await user.click(screen.getByRole("button", { name: /Try again/i }));

    await waitFor(() => {
      expect(screen.getByTestId("asset-search-results")).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("labels trust and visibility on every row", async () => {
    const user = userEvent.setup();
    renderPanel([result()]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "fridge");

    await waitFor(() => {
      expect(screen.getByText(/Confirmed fact/)).toBeTruthy();
    });
    expect(screen.getByText(/Whole household/)).toBeTruthy();
  });

  it("deep-links each result to its asset profile", async () => {
    const user = userEvent.setup();
    renderPanel([result()]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "fridge");

    await waitFor(() => {
      expect(screen.getByRole("link").getAttribute("href")).toBe("/assets/asset-1");
    });
  });

  it("offers a way forward when nothing matches", async () => {
    const user = userEvent.setup();
    renderPanel([]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "nonsense");

    await waitFor(() => {
      expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    });
  });

  it("restores browsing when the query is cleared", async () => {
    const user = userEvent.setup();
    renderPanel([result()]);
    const field = screen.getByRole("searchbox", { name: /search your things/i });

    await user.type(field, "fridge");
    await waitFor(() => {
      expect(screen.getByTestId("asset-search-results")).toBeTruthy();
    });
    await user.clear(field);

    await waitFor(() => {
      expect(screen.getByText("Browse list")).toBeTruthy();
    });
  });

  it("debounces — typing a word does not fire a search per keystroke", async () => {
    const user = userEvent.setup();
    const { search } = renderPanel([result()]);

    await user.type(screen.getByRole("searchbox", { name: /search your things/i }), "fridge");

    await waitFor(() => {
      expect(search).toHaveBeenCalled();
    });
    expect(search.mock.calls.length).toBeLessThan(6);
  });
});
