// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingAssetActionProposalView } from "@/lib/asset-action-proposal-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM behavior for the Asset Profile's reminder proposals (#203): a proposal reads as
 * tentative and names the detail it came from, review runs through the EXISTING
 * Suggested General Action path (never an asset-specific one), and proposing is
 * something the owner asks for rather than something Tendnote does at them.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const proposeAssetMemoryActionsAction = vi.fn();
vi.mock("@/app/actions/asset-action-proposals", () => ({
  proposeAssetMemoryActionsAction: (input: unknown) => proposeAssetMemoryActionsAction(input),
}));

const acceptSuggestedGeneralActionAction = vi.fn();
const ignoreSuggestedGeneralActionAction = vi.fn();
vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: (input: unknown) => acceptSuggestedGeneralActionAction(input),
  ignoreSuggestedGeneralActionAction: (input: unknown) => ignoreSuggestedGeneralActionAction(input),
}));

import { AssetActionProposals } from "./asset-action-proposals";

const ASSET_ID = "11111111-1111-1111-1111-111111111111";
const ACTION_ID = "22222222-2222-2222-2222-222222222222";

function proposal(
  overrides: Partial<PendingAssetActionProposalView> = {},
): PendingAssetActionProposalView {
  return {
    generalActionId: ACTION_ID,
    title: "Replace Refrigerator water filter",
    memoryLabel: "Replacement interval",
    recurrenceLabel: "Every 6 months",
    timingLabel: "Due Jan 13",
    ...overrides,
  };
}

beforeEach(() => {
  refresh.mockReset();
  proposeAssetMemoryActionsAction.mockReset();
  acceptSuggestedGeneralActionAction.mockReset();
  ignoreSuggestedGeneralActionAction.mockReset();
});

describe("AssetActionProposals (#203)", () => {
  it("reads as tentative and names the detail it was proposed from", () => {
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[proposal()]} />);

    expect(screen.getByText("Replace Refrigerator water filter")).toBeTruthy();
    // Tentative by text, not by color alone.
    expect(screen.getByText("Suggested")).toBeTruthy();
    expect(screen.getByText("Every 6 months")).toBeTruthy();
    expect(screen.getByText("Due Jan 13")).toBeTruthy();
    // The reasoning rides along, so accepting is an informed choice.
    expect(screen.getByText(/Replacement interval/)).toBeTruthy();
  });

  it("accepts a proposal through the existing Suggested General Action path", async () => {
    const user = userEvent.setup();
    acceptSuggestedGeneralActionAction.mockResolvedValue({});
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[proposal()]} />);

    await user.click(screen.getByRole("button", { name: /Add .* to your actions/ }));

    await waitFor(() => {
      expect(acceptSuggestedGeneralActionAction).toHaveBeenCalledWith({
        generalActionId: ACTION_ID,
      });
    });
    // No asset-side promotion call exists — acceptance flips the action row in place.
    expect(proposeAssetMemoryActionsAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("sets a proposal aside through the existing ignore path", async () => {
    const user = userEvent.setup();
    ignoreSuggestedGeneralActionAction.mockResolvedValue({});
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[proposal()]} />);

    await user.click(screen.getByRole("button", { name: /Set aside/ }));

    await waitFor(() => {
      expect(ignoreSuggestedGeneralActionAction).toHaveBeenCalledWith({
        generalActionId: ACTION_ID,
      });
    });
  });

  it("proposes only when asked — never on render", () => {
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    // The whole guarantee against a background scanner: rendering the profile must
    // not generate review items (#196).
    expect(proposeAssetMemoryActionsAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Suggest reminders/ })).toBeTruthy();
  });

  it("says so calmly when a pass finds nothing new, rather than failing", async () => {
    const user = userEvent.setup();
    proposeAssetMemoryActionsAction.mockResolvedValue({ ok: true, view: { proposed: 0 } });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(screen.getByText(/Nothing new to suggest/)).toBeTruthy();
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the profile when a pass proposes something", async () => {
    const user = userEvent.setup();
    proposeAssetMemoryActionsAction.mockResolvedValue({ ok: true, view: { proposed: 2 } });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("surfaces a curated refusal inline", async () => {
    const user = userEvent.setup();
    proposeAssetMemoryActionsAction.mockResolvedValue({
      ok: false,
      error: "This asset is archived — restore it before proposing reminders.",
    });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(screen.getByText(/restore it before proposing reminders/)).toBeTruthy();
    });
  });

  it("shows nothing at all to a viewer who cannot propose and has no proposals", () => {
    const { container } = render(
      <AssetActionProposals assetId={ASSET_ID} canPropose={false} proposals={[]} />,
    );

    // A co-member never sees the owner's review state, nor an ask they cannot make.
    expect(container.textContent).toBe("");
  });
});
