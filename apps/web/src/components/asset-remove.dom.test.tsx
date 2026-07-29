// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const hardDeleteAssetAction = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/actions/assets", () => ({
  hardDeleteAssetAction: (...args: unknown[]) => hardDeleteAssetAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { AssetRemove } from "./asset-remove";

describe("AssetRemove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains cascade and link behavior before a privacy delete", async () => {
    const user = userEvent.setup();
    render(
      <AssetRemove
        assetId="asset-1"
        assetName="Kitchen refrigerator"
        summary={{ memories: 2, evidence: 1, reviewItems: 1, linkedRecords: 3 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete asset permanently" }));
    expect(screen.getByRole("heading", { name: "Delete Kitchen refrigerator?" })).toBeDefined();
    expect(screen.getByText(/2 memories/)).toBeDefined();
    expect(screen.getByText(/evidence item/)).toBeDefined();
    expect(screen.getByText(/linked actions, people, and other assets stay intact/i)).toBeDefined();
    expect(screen.getByLabelText(/Type .* to confirm/i)).toBeDefined();
  });

  it("deletes an empty mistaken asset without a phrase and returns to Assets", async () => {
    hardDeleteAssetAction.mockResolvedValue({ ok: true, view: null });
    const user = userEvent.setup();
    render(
      <AssetRemove
        assetId="asset-1"
        assetName="Typo"
        summary={{ memories: 0, evidence: 0, reviewItems: 0, linkedRecords: 0 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete asset permanently" }));
    await user.click(screen.getByRole("button", { name: "Delete asset" }));

    await waitFor(() => expect(hardDeleteAssetAction).toHaveBeenCalledWith({ assetId: "asset-1" }));
    expect(push).toHaveBeenCalledWith("/assets");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the confirm phrase when the counts could not be read", async () => {
    const user = userEvent.setup();
    render(<AssetRemove assetId="asset-1" assetName="Kitchen refrigerator" summary={null} />);

    await user.click(screen.getByRole("button", { name: "Delete asset permanently" }));

    // An unreadable summary is not an empty asset: the gate that a genuinely
    // empty asset waives has to stay up, and the dialog must not claim zeros.
    expect(screen.getByLabelText(/Type .* to confirm/i)).toBeDefined();
    expect(screen.getByText(/can't list what is stored here/i)).toBeDefined();
    expect(screen.queryByText(/0 memories/)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete asset" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Delete asset" }));
    expect(hardDeleteAssetAction).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows an inline refusal when deletion is rejected", async () => {
    hardDeleteAssetAction.mockResolvedValue({
      ok: false,
      error: "This asset cannot be deleted while a protected link remains.",
    });
    const user = userEvent.setup();
    render(
      <AssetRemove
        assetId="asset-1"
        assetName="Protected asset"
        summary={{ memories: 0, evidence: 0, reviewItems: 0, linkedRecords: 1 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete asset permanently" }));
    await user.click(screen.getByRole("button", { name: "Delete asset" }));

    expect(
      await screen.findByText("This asset cannot be deleted while a protected link remains."),
    ).toBeDefined();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete Protected asset?" })).toBeDefined();
  });
});
