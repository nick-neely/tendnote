// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { assetViewFixture } from "@/components/asset-fixtures";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the Asset Profile controls (#197): archive/restore act
 * through the server actions and refresh the server-rendered profile; the edit
 * form (name + kind) is owner-only and submits only real changes.
 */

const archiveAssetAction = vi.fn();
const editAssetAction = vi.fn();
const restoreAssetAction = vi.fn();

vi.mock("@/app/actions/assets", () => ({
  archiveAssetAction: (...args: unknown[]) => archiveAssetAction(...args),
  editAssetAction: (...args: unknown[]) => editAssetAction(...args),
  restoreAssetAction: (...args: unknown[]) => restoreAssetAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { AssetProfileControls } from "./asset-profile-controls";

describe("AssetProfileControls", () => {
  it("archives an active asset and refreshes the profile", async () => {
    const user = userEvent.setup();
    const asset = assetViewFixture();
    archiveAssetAction.mockResolvedValue({ ok: true, view: { ...asset, archived: true } });
    render(<AssetProfileControls asset={asset} />);

    await user.click(screen.getByRole("button", { name: /Archive/ }));

    await waitFor(() => expect(archiveAssetAction).toHaveBeenCalledWith({ assetId: asset.id }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("offers restore instead of archive for an archived asset", () => {
    render(
      <AssetProfileControls asset={assetViewFixture({ archived: true, status: "archived" })} />,
    );

    expect(screen.getByRole("button", { name: /Restore/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Archive$/ })).toBeNull();
    // An archived asset is read-only content — no editing until restored.
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("hides the edit control from a non-owner who can still act on the asset", () => {
    render(<AssetProfileControls asset={assetViewFixture({ owned: false })} />);

    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Archive/ })).toBeDefined();
  });

  it("renames through the inline edit form, which also offers the kind select", async () => {
    const user = userEvent.setup();
    const asset = assetViewFixture();
    editAssetAction.mockResolvedValue({
      ok: true,
      view: { ...asset, name: "Fridge filter (MWF)" },
    });
    render(<AssetProfileControls asset={asset} />);

    await user.click(screen.getByRole("button", { name: /Edit/ }));
    // The kind control is present and carries the asset's current kind.
    expect(screen.getByRole("combobox", { name: "Kind" }).textContent).toContain("Appliance");

    const input = screen.getByRole("textbox", { name: "Asset name" });
    await user.clear(input);
    await user.type(input, "Fridge filter (MWF)");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Only the changed field rides the edit — the untouched kind stays out.
    await waitFor(() =>
      expect(editAssetAction).toHaveBeenCalledWith({
        assetId: asset.id,
        name: "Fridge filter (MWF)",
      }),
    );
  });

  it("surfaces a validation failure inline", async () => {
    const user = userEvent.setup();
    const asset = assetViewFixture();
    archiveAssetAction.mockResolvedValue({
      ok: false,
      error: "Cannot archive an asset that is archived.",
    });
    render(<AssetProfileControls asset={asset} />);

    await user.click(screen.getByRole("button", { name: /Archive/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Cannot archive an asset that is archived.",
      ),
    );
  });
});
