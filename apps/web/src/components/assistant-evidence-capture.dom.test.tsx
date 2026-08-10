// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDestination } from "@/lib/asset-evidence-destination";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for Eve's chat plus-menu Asset Evidence capture (#201): the
 * camera / photo library / file entries, destination disambiguation (clear
 * context preselects; several candidates ask; nothing yet routes to a
 * review-gated new asset), and that every submit lands on the SAME shared
 * server actions as the profile drop zone and review card — chat never grows
 * its own attachment write path.
 */

const addAssetEvidenceAction = vi.fn();
const addAssetEvidenceToNewAssetAction = vi.fn();
const listAssetEvidenceDestinationsAction = vi.fn();
vi.mock("@/app/actions/asset-evidence", () => ({
  addAssetEvidenceAction: (...args: unknown[]) => addAssetEvidenceAction(...args),
  addAssetEvidenceToNewAssetAction: (...args: unknown[]) =>
    addAssetEvidenceToNewAssetAction(...args),
  listAssetEvidenceDestinationsAction: (...args: unknown[]) =>
    listAssetEvidenceDestinationsAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { AssistantCaptureMenu } from "./assistant-capture-menu";
import { AssistantEvidenceCapture } from "./assistant-evidence-capture";

// jsdom ships no object-URL support; previews just need stable strings. It also
// lacks ResizeObserver, which the radix Checkbox measures its bubble input with.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  addAssetEvidenceAction.mockReset();
  addAssetEvidenceToNewAssetAction.mockReset();
  listAssetEvidenceDestinationsAction.mockReset();
  refresh.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

function pngFile(name = "receipt.png", bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

function assetDestination(overrides: Partial<EvidenceDestination> = {}): EvidenceDestination {
  return {
    targetKind: "asset",
    id: "asset-1",
    name: "Refrigerator",
    kind: "appliance",
    kindLabel: "Appliance",
    scope: "private",
    visibilityLabel: "Only me",
    ...overrides,
  } as EvidenceDestination;
}

function reviewDestination(): EvidenceDestination {
  return {
    targetKind: "review",
    groupId: "group-1",
    assetName: "Fridge filter",
    kind: "appliance",
    kindLabel: "Appliance",
    scope: "private",
  };
}

function evidenceView(overrides: Partial<AssetEvidenceView> = {}): AssetEvidenceView {
  return {
    id: "ev-1",
    kind: "photo",
    kindLabel: "Photo",
    label: "receipt",
    hasFile: true,
    fileName: "receipt.png",
    isImage: true,
    fileHref: "/api/asset-evidence/ev-1/file",
    sizeLabel: "4 KB",
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

/** Submits the shared details form and returns the FormData the action received. */
async function attachThroughDetailsForm(
  user: ReturnType<typeof userEvent.setup>,
  action: ReturnType<typeof vi.fn>,
): Promise<FormData> {
  await user.click(screen.getByRole("button", { name: /attach evidence/i }));
  await waitFor(() => expect(action).toHaveBeenCalled());
  return action.mock.calls[0]?.[0] as FormData;
}

describe("AssistantCaptureMenu", () => {
  it("offers camera, photo library, and file entries that hand the pick to the panel", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<AssistantCaptureMenu onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /attach asset evidence/i }));

    // All three capture entries, in one plus-menu (#196 story 23).
    expect(await screen.findByRole("menuitem", { name: /take a photo/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /photo library/i })).toBeTruthy();
    const fileEntry = screen.getByRole("menuitem", { name: /attach a file/i });
    await user.click(fileEntry);

    // The menu routes through a native picker; simulate its selection.
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length).toBe(3);
    const file = pngFile();
    await user.upload(inputs[2] as HTMLInputElement, file);

    expect(onPick).toHaveBeenCalledWith(file);
  });
});

describe("AssistantEvidenceCapture", () => {
  it("asks the user to choose when several destinations exist, then routes to the shared action", async () => {
    const user = userEvent.setup();
    listAssetEvidenceDestinationsAction.mockResolvedValue([
      assetDestination(),
      reviewDestination(),
    ]);
    addAssetEvidenceAction.mockResolvedValue({ ok: true, view: evidenceView() });
    render(<AssistantEvidenceCapture file={pngFile()} onClose={vi.fn()} />);

    // Unclear destination: the panel asks; nothing is preselected or guessed.
    expect(await screen.findByText("Where does this belong?")).toBeTruthy();
    expect(addAssetEvidenceAction).not.toHaveBeenCalled();

    // Only what the destinations action returned is offered — visible-only
    // context, resolved server-side by the owner-scoped seam.
    expect(screen.getByRole("button", { name: /refrigerator/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /fridge filter/i }));

    // The shared details form, aimed at the chosen review item.
    expect(screen.getByText(/attach to the review item for fridge filter/i)).toBeTruthy();
    const formData = await attachThroughDetailsForm(user, addAssetEvidenceAction);
    expect(formData.get("reviewGroupId")).toBe("group-1");
    expect(formData.get("assetId")).toBeNull();
    expect(addAssetEvidenceToNewAssetAction).not.toHaveBeenCalled();

    // A calm confirmation; the transcript itself never becomes an inbox.
    expect((await screen.findByRole("status")).textContent).toMatch(
      /attached to the review item for fridge filter/i,
    );
  });

  it("takes focus when the pick opens it, and names the file's escape a discard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    listAssetEvidenceDestinationsAction.mockResolvedValue([assetDestination()]);
    render(<AssistantEvidenceCapture file={pngFile()} onClose={onClose} />);

    // The plus-menu that had focus is gone; the panel catches it, so a keyboard
    // user is never dropped to <body> to tab the whole page back (DESIGN.md §8).
    const panel = screen.getByRole("region", { name: /attach asset evidence/i });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

    // The details form is unframed inside the panel — one card, never nested
    // (DESIGN.md §6) — and its file escape says what it does: it discards.
    await screen.findByText("Attach to Refrigerator");
    expect(screen.queryByRole("button", { name: /choose a different file/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /discard capture/i }));
    expect(onClose).toHaveBeenCalled();
    expect(addAssetEvidenceAction).not.toHaveBeenCalled();
  });

  it("preselects the destination when exactly one candidate is clear from context", async () => {
    const user = userEvent.setup();
    listAssetEvidenceDestinationsAction.mockResolvedValue([assetDestination()]);
    addAssetEvidenceAction.mockResolvedValue({ ok: true, view: evidenceView() });
    render(<AssistantEvidenceCapture file={pngFile()} onClose={vi.fn()} />);

    // Straight to the details form, destination named and changeable — the
    // submit is still the user's explicit confirmation.
    expect(await screen.findByText("Attach to Refrigerator")).toBeTruthy();
    expect(screen.getByRole("button", { name: /change/i })).toBeTruthy();

    const formData = await attachThroughDetailsForm(user, addAssetEvidenceAction);
    expect(formData.get("assetId")).toBe("asset-1");

    // Landing on a durable asset offers the hop to its profile.
    expect((await screen.findByRole("status")).textContent).toMatch(/attached to refrigerator/i);
    expect(screen.getByRole("link", { name: /view asset/i }).getAttribute("href")).toBe(
      "/assets/asset-1",
    );
  });

  it("routes an unmatched capture to a review-gated new Suggested Asset", async () => {
    const user = userEvent.setup();
    listAssetEvidenceDestinationsAction.mockResolvedValue([]);
    addAssetEvidenceToNewAssetAction.mockResolvedValue({
      ok: true,
      view: { evidence: evidenceView(), assetName: "Dishwasher" },
    });
    render(<AssistantEvidenceCapture file={pngFile()} onClose={vi.fn()} />);

    // Nothing tracked yet: the naming form is the only path, and it says the
    // write is review-gated before anything is typed.
    expect(await screen.findByText(/name what this belongs to/i)).toBeTruthy();
    expect(screen.getByText(/you'll confirm this in review/i)).toBeTruthy();

    const nameInput = screen.getByRole("textbox", { name: /new asset name/i });
    const cont = screen.getByRole("button", { name: /continue/i });
    // No name, no proposal.
    expect(cont).toHaveProperty("disabled", true);
    await user.type(nameInput, "Dishwasher");
    await user.click(cont);

    expect(screen.getByText(/new: dishwasher \(for review\)/i)).toBeTruthy();
    const formData = await attachThroughDetailsForm(user, addAssetEvidenceToNewAssetAction);
    expect(formData.get("assetName")).toBe("Dishwasher");
    expect(formData.get("assetKind")).toBe("item");
    expect(addAssetEvidenceAction).not.toHaveBeenCalled();

    expect((await screen.findByRole("status")).textContent).toMatch(/waiting in review/i);
  });

  it("refuses a disallowed pick with the domain's own words and writes nothing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AssistantEvidenceCapture
        file={new File([new Uint8Array(4)], "dump.zip", { type: "application/zip" })}
        onClose={onClose}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/JPEG, PNG, WebP, HEIC, or PDF/);
    // No destination step, no fetch, no write for a refused file.
    expect(listAssetEvidenceDestinationsAction).not.toHaveBeenCalled();
    expect(addAssetEvidenceAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
