// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetViewFixture } from "@/components/asset-fixtures";
import { ReversibleMutationProvider } from "@/lib/reversible-mutation";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM behaviour for the Phase Eight household affordances on an Asset (#386):
 * what a row says about whose thing it is, which controls a co-member is offered
 * on someone else's car versus the household's refrigerator, and what a member
 * sees when two of them edit the same field at once.
 */

vi.mock("@/app/actions/assets", () => ({
  archiveAssetAction: vi.fn(),
  editAssetAction: vi.fn(),
  restoreAssetAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { archiveAssetAction, editAssetAction } from "@/app/actions/assets";
import { AssetAttributionLine, AssetProvenanceLine } from "@/components/asset-household";
import { AssetProfileControls } from "@/components/asset-profile-controls";

const VIEWER = "user-viewer";
const PARTNER = "user-partner";
const MEMBERS = [
  { userId: PARTNER, name: "Mara", email: "mara@example.com" },
  { userId: VIEWER, name: "Nick", email: "nick@example.com" },
];

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReversibleMutationProvider>{ui}</ReversibleMutationProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("whose asset this is", () => {
  it("credits the household, never the member who created it", () => {
    const asset = assetViewFixture({
      ownership: "household_native",
      owned: true,
      scope: "household",
      ownerUserId: VIEWER,
    });

    render(<AssetAttributionLine asset={asset} members={MEMBERS} />);

    expect(screen.getByText("Household")).toBeTruthy();
    expect(screen.queryByText(/Shared by/)).toBeNull();
  });

  it("names the owner of an asset shared with you", () => {
    const asset = assetViewFixture({
      owned: false,
      scope: "household",
      ownerUserId: PARTNER,
      viewerUserId: VIEWER,
    });

    render(<AssetAttributionLine asset={asset} members={MEMBERS} />);

    expect(screen.getByText("Shared by Mara")).toBeTruthy();
  });

  it("says nothing at all about your own private asset", () => {
    const { container } = render(
      <AssetAttributionLine asset={assetViewFixture()} members={MEMBERS} />,
    );

    expect(container.textContent).toBe("");
  });
});

describe("provenance on a shared asset", () => {
  it("names who added it and who last changed it, quietly and once", () => {
    const asset = assetViewFixture({
      ownership: "household_native",
      scope: "household",
      viewerUserId: VIEWER,
      createdByUserId: PARTNER,
      lastActorUserId: VIEWER,
    });

    render(<AssetProvenanceLine asset={asset} members={MEMBERS} viewerUserId={VIEWER} />);

    expect(screen.getByText("Added by Mara · Last changed by you")).toBeTruthy();
  });

  it("does not tell you that you wrote in your own notebook", () => {
    const { container } = render(
      <AssetProvenanceLine
        asset={assetViewFixture({ createdByUserId: VIEWER, lastActorUserId: VIEWER })}
        members={MEMBERS}
        viewerUserId={VIEWER}
      />,
    );

    expect(container.textContent).toBe("");
  });
});

describe("what a co-member is offered", () => {
  it("offers neither editing nor archiving on someone else's asset", () => {
    const asset = assetViewFixture({
      owned: false,
      scope: "household",
      ownerUserId: PARTNER,
      viewerUserId: VIEWER,
    });

    renderWithProvider(<AssetProfileControls asset={asset} members={MEMBERS} />);

    // Absent, not disabled: a greyed control is a promise the product is not
    // making, and the refusal it would earn discloses nothing anyway.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("offers both on the household's own asset", () => {
    const asset = assetViewFixture({
      ownership: "household_native",
      owned: false,
      scope: "household",
      ownerUserId: PARTNER,
      viewerUserId: VIEWER,
    });

    renderWithProvider(<AssetProfileControls asset={asset} members={MEMBERS} />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("archives rather than deletes, whoever is acting", async () => {
    vi.mocked(archiveAssetAction).mockResolvedValue({
      ok: true,
      view: assetViewFixture({ archived: true }),
    });
    const asset = assetViewFixture({
      ownership: "household_native",
      owned: false,
      scope: "household",
      ownerUserId: PARTNER,
      viewerUserId: VIEWER,
    });

    renderWithProvider(<AssetProfileControls asset={asset} members={MEMBERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(archiveAssetAction).toHaveBeenCalledWith({ assetId: asset.id }));
  });
});

describe("two members editing at once", () => {
  it("keeps the draft, says what it reads now and who put it there, then replaces on the next save", async () => {
    vi.mocked(editAssetAction)
      .mockResolvedValueOnce({
        ok: false,
        error: "Someone else changed this while you were editing.",
        conflict: { currentValue: "Kitchen fridge", actorUserId: PARTNER, revision: 4 },
      })
      .mockResolvedValueOnce({ ok: true, view: assetViewFixture({ name: "The big fridge" }) });

    const asset = assetViewFixture({
      ownership: "household_native",
      name: "Refrigerator",
      contentRevision: 3,
      scope: "household",
      viewerUserId: VIEWER,
    });

    renderWithProvider(<AssetProfileControls asset={asset} members={MEMBERS} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const nameField = screen.getByLabelText("Asset name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "The big fridge");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The actor is named from the roster, never shown as a raw id.
    // Rendered inline and announced in the live region, hence the plural read.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          "Mara changed this to “Kitchen fridge”. Save again to replace it with yours.",
        ).length,
      ).toBeGreaterThan(0),
    );
    // The draft survived the lost race untouched.
    expect(screen.getByLabelText<HTMLInputElement>("Asset name").value).toBe("The big fridge");
    expect(editAssetAction).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The second save is the deliberate replace the message offered: no
    // expectation travels with it, so it cannot lose the same race twice.
    await waitFor(() => expect(editAssetAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(editAssetAction).mock.calls[1]?.[0]).not.toHaveProperty("expectedRevision");
  });
});
