// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetPersonLinkView, RelatedAssetLinkView } from "@/lib/asset-link-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM behavior for the Asset Profile's two link sections (#202), which share
 * the asset-links server-action module.
 *
 * Related Asset Links: each link reads as one calm sentence deep-linking to the
 * other asset's profile; pending inferred suggestions are review-gated with
 * inline accept/set-aside; owners can remove their links; and the add form
 * links outward with the fixed relation set.
 *
 * People: contextual person links read as "‹Name› — relation" rows deep-linking
 * to the person; the viewer removes their own links and adds one of their
 * people with a fixed contextual relation — never ownership or visibility.
 */

const addAssetLinkAction = vi.fn();
const acceptSuggestedAssetLinkAction = vi.fn();
const dismissSuggestedAssetLinkAction = vi.fn();
const removeAssetLinkAction = vi.fn();
const addAssetPersonLinkAction = vi.fn();
const removeAssetPersonLinkAction = vi.fn();

vi.mock("@/app/actions/asset-links", () => ({
  addAssetLinkAction: (...args: unknown[]) => addAssetLinkAction(...args),
  acceptSuggestedAssetLinkAction: (...args: unknown[]) => acceptSuggestedAssetLinkAction(...args),
  dismissSuggestedAssetLinkAction: (...args: unknown[]) => dismissSuggestedAssetLinkAction(...args),
  removeAssetLinkAction: (...args: unknown[]) => removeAssetLinkAction(...args),
  addAssetPersonLinkAction: (...args: unknown[]) => addAssetPersonLinkAction(...args),
  removeAssetPersonLinkAction: (...args: unknown[]) => removeAssetPersonLinkAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetPersonLinks } from "./asset-person-links";
import { AssetRelatedLinks } from "./asset-related-links";

const ASSET_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ID = "00000000-0000-0000-0000-000000000002";
const PERSON_ID = "20000000-0000-0000-0000-000000000001";

function linkView(overrides: Partial<RelatedAssetLinkView> = {}): RelatedAssetLinkView {
  return {
    linkId: "10000000-0000-0000-0000-000000000001",
    otherAssetId: OTHER_ID,
    otherAssetName: "Refrigerator",
    relation: "fits",
    phraseBefore: "Fits ",
    phraseAfter: "",
    pending: false,
    owned: true,
    ...overrides,
  };
}

function renderRelatedLinks(props: Partial<Parameters<typeof AssetRelatedLinks>[0]> = {}) {
  return render(
    <AssetRelatedLinks
      assetId={ASSET_ID}
      canLink
      linkableAssets={[{ id: OTHER_ID, name: "Refrigerator" }]}
      links={[]}
      {...props}
    />,
  );
}

describe("AssetRelatedLinks (#202)", () => {
  it("renders an outgoing link as a sentence deep-linking to the other profile", () => {
    renderRelatedLinks({ links: [linkView()] });

    const link = screen.getByRole("link", { name: "Refrigerator" });
    expect(link.getAttribute("href")).toBe(`/assets/${OTHER_ID}`);
    expect(screen.getByText(/Fits/)).toBeTruthy();
  });

  it("marks a pending suggestion and resolves it through accept", async () => {
    const user = userEvent.setup();
    acceptSuggestedAssetLinkAction.mockResolvedValue({ ok: true, view: null });
    renderRelatedLinks({ links: [linkView({ pending: true })] });

    expect(screen.getByText("Suggested")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Add link/ }));

    await waitFor(() =>
      expect(acceptSuggestedAssetLinkAction).toHaveBeenCalledWith({
        linkId: "10000000-0000-0000-0000-000000000001",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sets a pending suggestion aside without accepting it", async () => {
    const user = userEvent.setup();
    dismissSuggestedAssetLinkAction.mockResolvedValue({ ok: true, view: null });
    renderRelatedLinks({ links: [linkView({ pending: true })] });

    await user.click(screen.getByRole("button", { name: /Set aside/ }));

    await waitFor(() =>
      expect(dismissSuggestedAssetLinkAction).toHaveBeenCalledWith({
        linkId: "10000000-0000-0000-0000-000000000001",
      }),
    );
  });

  it("lets the link's owner remove it, and hides removal from other viewers", async () => {
    const user = userEvent.setup();
    removeAssetLinkAction.mockResolvedValue({ ok: true, view: null });
    renderRelatedLinks({
      links: [
        linkView(),
        linkView({
          linkId: "10000000-0000-0000-0000-000000000002",
          otherAssetName: "Garage shelf",
          owned: false,
        }),
      ],
    });

    // Only the owned row offers removal.
    expect(screen.queryByRole("button", { name: /Remove link to Garage shelf/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Remove link to Refrigerator/ }));

    await waitFor(() =>
      expect(removeAssetLinkAction).toHaveBeenCalledWith({
        linkId: "10000000-0000-0000-0000-000000000001",
      }),
    );
  });

  it("adds an outgoing link through the sentence-shaped form", async () => {
    const user = userEvent.setup();
    addAssetLinkAction.mockResolvedValue({ ok: true, view: null });
    renderRelatedLinks();

    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(addAssetLinkAction).toHaveBeenCalledWith({
        fromAssetId: ASSET_ID,
        toAssetId: OTHER_ID,
        relation: "fits",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("offers no add form when linking is unavailable, and teaches the empty state", () => {
    renderRelatedLinks({ canLink: false });

    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    expect(screen.getByText(/No related assets yet/)).toBeTruthy();
  });

  it("offers no add form when there is nothing to link to", () => {
    renderRelatedLinks({ linkableAssets: [] });

    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
  });
});

function personLinkView(overrides: Partial<AssetPersonLinkView> = {}): AssetPersonLinkView {
  return {
    linkId: "30000000-0000-0000-0000-000000000001",
    personId: PERSON_ID,
    displayName: "Marcus",
    relationLabel: "borrowed it",
    ...overrides,
  };
}

function renderPersonLinks(props: Partial<Parameters<typeof AssetPersonLinks>[0]> = {}) {
  return render(
    <AssetPersonLinks
      assetId={ASSET_ID}
      canLink
      links={[]}
      people={[{ id: PERSON_ID, displayName: "Marcus" }]}
      {...props}
    />,
  );
}

describe("AssetPersonLinks (#202)", () => {
  it("renders a person link as a quiet sentence deep-linking to the person", () => {
    // Without the add form, so the row's relation phrase is the only "borrowed it".
    renderPersonLinks({ canLink: false, links: [personLinkView()] });

    const link = screen.getByRole("link", { name: "Marcus" });
    expect(link.getAttribute("href")).toBe(`/people/${PERSON_ID}`);
    expect(screen.getByText("borrowed it")).toBeTruthy();
  });

  it("removes a person link and refreshes the profile", async () => {
    const user = userEvent.setup();
    removeAssetPersonLinkAction.mockResolvedValue({ ok: true, view: null });
    renderPersonLinks({ links: [personLinkView()] });

    await user.click(screen.getByRole("button", { name: /Remove link to Marcus/ }));

    await waitFor(() =>
      expect(removeAssetPersonLinkAction).toHaveBeenCalledWith({
        linkId: "30000000-0000-0000-0000-000000000001",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("links one of the viewer's people through the add form", async () => {
    const user = userEvent.setup();
    addAssetPersonLinkAction.mockResolvedValue({ ok: true, view: null });
    renderPersonLinks();

    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(addAssetPersonLinkAction).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        personId: PERSON_ID,
        relation: "recommended",
      }),
    );
  });

  it("offers no add form when linking is unavailable, and teaches the empty state", () => {
    renderPersonLinks({ canLink: false });

    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    expect(screen.getByText(/No people linked yet/)).toBeTruthy();
  });

  it("offers no add form when the viewer has no people", () => {
    renderPersonLinks({ people: [] });

    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
  });
});
