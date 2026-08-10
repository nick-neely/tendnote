// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM behavior of the Asset Profile evidence section (#200): the ledger list
 * with per-record privacy cues, the owner's two-step remove, and the read-only
 * viewer variant (a household member sees evidence, never capture or removal).
 */

const removeAssetEvidenceAction = vi.fn();
vi.mock("@/app/actions/asset-evidence", () => ({
  addAssetEvidenceAction: vi.fn(),
  removeAssetEvidenceAction: (...args: unknown[]) => removeAssetEvidenceAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { AssetEvidenceSection } from "./asset-evidence-section";

function view(overrides: Partial<AssetEvidenceView> = {}): AssetEvidenceView {
  return {
    id: "ev-1",
    kind: "receipt",
    kindLabel: "Receipt",
    label: "Home Depot receipt",
    hasFile: true,
    fileName: "receipt.jpg",
    isImage: true,
    fileHref: "/api/asset-evidence/ev-1/file",
    sizeLabel: "47 KB",
    url: null,
    capturedText: null,
    moneyLabel: null,
    purchasedOnLabel: null,
    renewsOnLabel: null,
    scope: "private",
    owned: true,
    ownership: "member_owned",
    canRemove: true,
    addedLabel: "Added Jul 13",
    ...overrides,
  };
}

describe("AssetEvidenceSection", () => {
  it("removes evidence through a two-step confirm, never on the first click", async () => {
    removeAssetEvidenceAction.mockResolvedValue({ ok: true, view: { evidenceId: "ev-1" } });
    const user = userEvent.setup();
    render(
      <AssetEvidenceSection
        assetId="a-1"
        assetScope="private"
        canCapture
        initialEvidence={[view()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /remove Home Depot receipt/i }));
    expect(removeAssetEvidenceAction).not.toHaveBeenCalled();

    // The confirm renders where the trash icon was and stays disarmed for a
    // beat, so a double-click can never delete (#200 review).
    const confirmButton = screen.getByRole("button", {
      name: /confirm removing Home Depot receipt/i,
    });
    await user.click(confirmButton);
    expect(removeAssetEvidenceAction).not.toHaveBeenCalled();

    await waitFor(() => expect(confirmButton).toHaveProperty("disabled", false));
    await user.click(confirmButton);
    await waitFor(() =>
      expect(removeAssetEvidenceAction).toHaveBeenCalledWith({ evidenceId: "ev-1" }),
    );
    await waitFor(() => expect(screen.queryByText("Home Depot receipt")).toBeNull());
  });

  it("marks a private record under a household asset and keeps viewers read-only", () => {
    render(
      <AssetEvidenceSection
        assetId="a-1"
        assetScope="household"
        canCapture={false}
        initialEvidence={[view({ owned: false, scope: "household" }), view({ id: "ev-9" })]}
      />,
    );

    // The owner's private receipt carries its quiet cue; household records don't.
    expect(screen.getAllByText("Just me")).toHaveLength(1);
    // A viewer gets no capture affordances and no removal, only the record.
    expect(screen.queryByRole("button", { name: /add evidence/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
