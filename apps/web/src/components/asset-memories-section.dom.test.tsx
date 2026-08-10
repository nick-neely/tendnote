// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetMemoryView } from "@/lib/asset-memory-view";
import { act, fireEvent, render, screen, waitFor } from "@/test/dom";

/**
 * DOM behaviour for maintaining the details on an Asset (#386): who is offered
 * the controls, and — the part the copy promises — that setting one aside is
 * genuinely reversible rather than merely worded that way.
 */

vi.mock("@/app/actions/asset-memories", () => ({
  createAssetMemoryAction: vi.fn(),
  editAssetMemoryAction: vi.fn(),
  restoreAssetMemoryAction: vi.fn(),
  setAsideAssetMemoryAction: vi.fn(),
}));

import { restoreAssetMemoryAction, setAsideAssetMemoryAction } from "@/app/actions/asset-memories";
import { AssetMemoriesSection } from "@/components/asset-memories-section";

const UNDO_WINDOW_MS = 5_000;

function memoryView(overrides: Partial<AssetMemoryView> = {}): AssetMemoryView {
  return {
    id: "memory-1",
    label: "Filter size",
    valueLabel: "EDR3RXD1",
    valueText: "EDR3RXD1",
    notes: null,
    ownership: "household_native",
    revision: 0,
    canWrite: true,
    ...overrides,
  };
}

function renderSection(overrides: Partial<AssetMemoryView> = {}) {
  return render(
    <AssetMemoriesSection
      archived={false}
      assetId="00000000-0000-4000-8000-000000000001"
      canAddHouseholdDetail
      initialMemories={[memoryView(overrides)]}
      members={[{ userId: "user-partner", name: "Mara", email: "mara@example.com" }]}
    />,
  );
}

/** Lets the command settle, then runs out the undo window and the leave frame. */
async function settleThenLeave() {
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("who may maintain a detail", () => {
  it("offers no controls on a detail this member may not write", () => {
    renderSection({ canWrite: false, ownership: "member_owned" });

    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
  });

  it("offers both on the household's own detail", () => {
    renderSection();

    expect(screen.getByRole("button", { name: "Correct" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set aside" })).toBeTruthy();
  });
});

describe("setting a detail aside", () => {
  it("keeps it reversible for the undo window, and restores the same record", async () => {
    vi.mocked(setAsideAssetMemoryAction).mockResolvedValue({ ok: true, view: memoryView() });
    vi.mocked(restoreAssetMemoryAction).mockResolvedValue({ ok: true, view: memoryView() });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Set aside" }));
    await waitFor(() => expect(setAsideAssetMemoryAction).toHaveBeenCalled());

    // The row is still there, holding an Undo — the copy says nothing is
    // removed, and for the whole window nothing visibly is.
    const undo = await screen.findByRole("button", { name: "Undo set aside" });
    expect(screen.getByText("Filter size")).toBeTruthy();

    fireEvent.click(undo);
    await waitFor(() =>
      expect(restoreAssetMemoryAction).toHaveBeenCalledWith({ memoryId: "memory-1" }),
    );
    // Restored in place: still one row, never a duplicate appended.
    expect(screen.getAllByText("Filter size")).toHaveLength(1);
  });

  it("names the detail when it announces what happened", async () => {
    vi.mocked(setAsideAssetMemoryAction).mockResolvedValue({ ok: true, view: memoryView() });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Set aside" }));

    // Not "Updated." — a member hearing this five rows down needs to know which
    // fact just stopped being true.
    await waitFor(() =>
      expect(
        screen.getAllByText(/“Filter size” set aside\. Undo available\./).length,
      ).toBeGreaterThan(0),
    );
  });

  it("puts focus somewhere real once the row is gone", async () => {
    vi.useFakeTimers();
    vi.mocked(setAsideAssetMemoryAction).mockResolvedValue({ ok: true, view: memoryView() });
    try {
      renderSection();

      fireEvent.click(screen.getByRole("button", { name: "Set aside" }));
      await settleThenLeave();

      // The only row left, so the shared helper falls through to the add
      // control. Without any anchor the browser drops focus to `body`, silently
      // returning a keyboard member to the top of the document.
      expect(screen.queryByText("Filter size")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a detail" }));
    } finally {
      vi.useRealTimers();
    }
  });
});
