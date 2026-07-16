// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { fireEvent, render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * DOM click-through for the shared Asset Evidence capture flow (#200): the
 * drop-zone states (idle, drag-over, rejected file), file selection into the
 * details form, the link path, the household keep-private narrowing, and the
 * inline validation error path. Every submit flows through the one
 * addAssetEvidenceAction; the capture surface never grows its own write path.
 */

const addAssetEvidenceAction = vi.fn();
vi.mock("@/app/actions/asset-evidence", () => ({
  addAssetEvidenceAction: (...args: unknown[]) => addAssetEvidenceAction(...args),
  removeAssetEvidenceAction: vi.fn(),
}));

import { AssetEvidenceCapture } from "./asset-evidence-capture";

// jsdom ships no object-URL support; previews just need stable strings. It also
// lacks ResizeObserver, which the radix Checkbox measures its bubble input with.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  addAssetEvidenceAction.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

function evidenceView(overrides: Partial<AssetEvidenceView> = {}): AssetEvidenceView {
  return {
    id: "ev-1",
    kind: "photo",
    kindLabel: "Photo",
    label: "Filter label",
    hasFile: true,
    fileName: "label.png",
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
    addedLabel: "Added Jul 13",
    ...overrides,
  };
}

function pngFile(name = "label.png", bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

/** The hidden browse input behind the drop zone (first file input in the tree). */
function browseInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("No file input rendered.");
  }
  return input;
}

describe("AssetEvidenceCapture", () => {
  it("renders the idle drop zone with browse, link, and note entries", () => {
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={vi.fn()} target={{ assetId: "a-1" }} />,
    );

    expect(
      screen.getByRole("button", { name: /add evidence: drop a file here or browse/i }),
    ).toBeTruthy();
    // The caption is derived from the domain allowlist — one source of truth.
    expect(screen.getByText(/JPEG, PNG, WebP, HEIC, or PDF · up to 10 MB/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a link/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a note/i })).toBeTruthy();
    // Camera entry exists for small screens (jsdom renders the mobile layer).
    expect(screen.getByRole("button", { name: /take a photo/i })).toBeTruthy();
  });

  it("shows the drag-over state while a file is over the zone", () => {
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={vi.fn()} target={{ assetId: "a-1" }} />,
    );
    const zone = screen.getByRole("button", { name: /add evidence/i });

    fireEvent.dragOver(zone);
    expect(screen.getByText("Drop to attach")).toBeTruthy();
    expect(zone.getAttribute("data-dragging")).toBe("true");

    fireEvent.dragLeave(zone);
    expect(zone.getAttribute("data-dragging")).toBe("false");
  });

  it("refuses a disallowed file inline and stays on the zone", async () => {
    // applyAccept off: a drag-and-drop bypasses the accept filter in real
    // browsers, so the component's own vetting is what protects the flow.
    const user = userEvent.setup({ applyAccept: false });
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={vi.fn()} target={{ assetId: "a-1" }} />,
    );

    await user.upload(
      browseInput(),
      new File([new Uint8Array(4)], "dump.zip", { type: "application/zip" }),
    );

    // The rejection names the same allowlist the caption advertises.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/JPEG, PNG, WebP, HEIC, or PDF/);
    // Still the zone — nothing was accepted into a details form.
    expect(screen.getByRole("button", { name: /add evidence/i })).toBeTruthy();
    expect(addAssetEvidenceAction).not.toHaveBeenCalled();
  });

  it("captures an uploaded photo through the details form to the asset target", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    addAssetEvidenceAction.mockResolvedValue({ ok: true, view: evidenceView() });
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={onAdded} target={{ assetId: "a-1" }} />,
    );

    await user.upload(browseInput(), pngFile("washer-label.png"));

    // Details form: label prefilled from the file name, kind guessed as photo.
    const label = screen.getByRole("textbox", { name: /evidence name/i });
    expect((label as HTMLInputElement).value).toBe("washer-label");
    expect(screen.getByText("washer-label.png")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /attach evidence/i }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(evidenceView()));
    const formData = addAssetEvidenceAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("assetId")).toBe("a-1");
    expect(formData.get("kind")).toBe("photo");
    expect(formData.get("label")).toBe("washer-label");
    expect(formData.get("file")).toBeInstanceOf(File);
  });

  it("captures a link with its own required url field to a review-group target", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    addAssetEvidenceAction.mockResolvedValue({
      ok: true,
      view: evidenceView({ kind: "link", hasFile: false, fileHref: null }),
    });
    render(
      <AssetEvidenceCapture
        assetScope="private"
        onAdded={onAdded}
        target={{ reviewGroupId: "g-1" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add a link/i }));

    const attach = screen.getByRole("button", { name: /attach evidence/i });
    // No label, no url — not submittable yet.
    expect(attach).toHaveProperty("disabled", true);

    await user.type(screen.getByRole("textbox", { name: /evidence name/i }), "Owner's manual");
    await user.type(
      screen.getByRole("textbox", { name: /link url/i }),
      "https://example.com/manual.pdf",
    );
    await user.click(attach);

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const formData = addAssetEvidenceAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("reviewGroupId")).toBe("g-1");
    expect(formData.get("kind")).toBe("link");
    expect(formData.get("url")).toBe("https://example.com/manual.pdf");
  });

  it("offers a real child audience choice under a household asset", async () => {
    const user = userEvent.setup();
    addAssetEvidenceAction.mockResolvedValue({ ok: true, view: evidenceView() });
    const { unmount } = render(
      <AssetEvidenceCapture
        assetScope="household"
        onAdded={vi.fn()}
        shareableMembers={[{ userId: "member-1", name: "Mara", email: "mara@example.com" }]}
        target={{ assetId: "a-1" }}
      />,
    );

    await user.upload(browseInput(), pngFile());
    await user.click(screen.getByRole("radio", { name: /specific people/i }));
    await user.click(screen.getByRole("checkbox", { name: /mara/i }));
    await user.click(screen.getByRole("button", { name: /attach evidence/i }));

    await waitFor(() => expect(addAssetEvidenceAction).toHaveBeenCalled());
    const formData = addAssetEvidenceAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("visibilityChoice")).toBe("selected_members");
    expect(formData.getAll("selectedUserIds")).toEqual(["member-1"]);
    unmount();

    // A private asset has nothing to narrow — the choice never renders.
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={vi.fn()} target={{ assetId: "a-1" }} />,
    );
    await user.upload(browseInput(), pngFile());
    expect(screen.queryByRole("group", { name: /visibility/i })).toBeNull();
  });

  it("shows and allows narrowing the inherited audience under a shared asset", async () => {
    const user = userEvent.setup();
    addAssetEvidenceAction.mockResolvedValue({ ok: true, view: evidenceView() });
    render(
      <AssetEvidenceCapture
        assetScope="shared"
        onAdded={vi.fn()}
        shareableMembers={[
          { userId: "member-1", name: "Mara", email: "mara@example.com" },
          { userId: "member-2", name: "Noah", email: "noah@example.com" },
        ]}
        target={{ assetId: "a-1" }}
      />,
    );

    await user.upload(browseInput(), pngFile());
    expect(screen.getByRole("checkbox", { name: /mara/i })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: /noah/i })).toHaveProperty("checked", true);
    await user.click(screen.getByRole("checkbox", { name: /noah/i }));
    await user.click(screen.getByRole("button", { name: /attach evidence/i }));

    await waitFor(() => expect(addAssetEvidenceAction).toHaveBeenCalled());
    const formData = addAssetEvidenceAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("visibilityChoice")).toBe("selected_members");
    expect(formData.getAll("selectedUserIds")).toEqual(["member-1"]);
  });

  it("renders a validation failure inline and keeps the form editable", async () => {
    const user = userEvent.setup();
    addAssetEvidenceAction.mockResolvedValue({ ok: false, error: "Name this evidence." });
    render(
      <AssetEvidenceCapture assetScope="private" onAdded={vi.fn()} target={{ assetId: "a-1" }} />,
    );

    await user.upload(browseInput(), pngFile());
    await user.click(screen.getByRole("button", { name: /attach evidence/i }));

    expect((await screen.findByRole("alert")).textContent).toBe("Name this evidence.");
    expect(screen.getByRole("textbox", { name: /evidence name/i })).toBeTruthy();
  });
});
