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

    // The verbs are named, not glyphs — the same two words the suggested links above
    // this section use (#202), so the profile speaks one review language.
    await user.click(screen.getByRole("button", { name: "Add reminder" }));

    await waitFor(() => {
      expect(acceptSuggestedGeneralActionAction).toHaveBeenCalledWith({
        generalActionId: ACTION_ID,
      });
    });
    // No asset-side promotion call exists — acceptance flips the action row in place.
    expect(proposeAssetMemoryActionsAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps focus in the section and announces the outcome when a row resolves", async () => {
    const user = userEvent.setup();
    ignoreSuggestedGeneralActionAction.mockResolvedValue({});
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[proposal()]} />);

    await user.click(screen.getByRole("button", { name: "Set aside" }));

    await waitFor(() => {
      // The resolved row takes its own buttons out of the document; without a catch,
      // focus falls to <body> and a keyboard user loses their place entirely.
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(screen.getByRole("status", { name: "Reminder proposals" }).textContent).toContain(
      "Set aside “Replace Refrigerator water filter”",
    );
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

  it("never claims a rejected detail already has a reminder", async () => {
    const user = userEvent.setup();
    // The pass proposed nothing because the detail already had its say — which includes
    // the detail whose proposal the owner just turned down. Telling them "it already has
    // a reminder" would be a lie about the thing they themselves refused.
    proposeAssetMemoryActionsAction.mockResolvedValue({
      ok: true,
      view: { proposed: 0, alreadySpokenFor: 1 },
    });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(screen.getByText(/already been through review/)).toBeTruthy();
    });
    expect(screen.queryByText(/already have reminders/)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("teaches where reminders come from when no detail carries a date", async () => {
    const user = userEvent.setup();
    proposeAssetMemoryActionsAction.mockResolvedValue({
      ok: true,
      view: { proposed: 0, alreadySpokenFor: 0 },
    });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(screen.getByText(/details with a date or a cadence/)).toBeTruthy();
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the profile when a pass proposes something", async () => {
    const user = userEvent.setup();
    proposeAssetMemoryActionsAction.mockResolvedValue({
      ok: true,
      view: { proposed: 2, alreadySpokenFor: 0 },
    });
    render(<AssetActionProposals assetId={ASSET_ID} canPropose proposals={[]} />);

    await user.click(screen.getByRole("button", { name: /Suggest reminders/ }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(screen.getByRole("status", { name: "Reminder proposals" }).textContent).toContain(
      "2 reminders suggested",
    );
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
