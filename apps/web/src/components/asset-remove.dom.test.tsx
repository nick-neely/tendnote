// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
    hardDeleteAssetAction.mockResolvedValue(undefined);
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
});
