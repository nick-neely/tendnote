// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetHistoryEntryView } from "@/lib/asset-history-view";
import { render, screen } from "@/test/dom";

/**
 * DOM behavior for the Asset Profile's derived History section (#202): each row
 * is a calm label + record + date; action-derived rows deep-link back into the
 * Actions surface — General Action lifecycle stays the source of truth (#196).
 */

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetHistory } from "./asset-history";

function entry(overrides: Partial<AssetHistoryEntryView> = {}): AssetHistoryEntryView {
  return {
    id: "asset-e1",
    label: "Added",
    detail: null,
    actionId: null,
    atISO: "2026-07-01T12:00:00.000Z",
    atLabel: "Jul 1",
    ...overrides,
  };
}

describe("AssetHistory (#202)", () => {
  it("renders lifecycle, detail, and action rows with their dates", () => {
    render(
      <AssetHistory
        entries={[
          entry({
            id: "action-a1",
            label: "Completed",
            detail: "Replace the refrigerator water filter",
            actionId: "44444444-4444-4444-4444-444444444444",
            atLabel: "Jul 10",
          }),
          entry({
            id: "memory-m1",
            label: "Detail added",
            detail: "Filter size",
            atLabel: "Jul 2",
          }),
          entry(),
        ]}
      />,
    );

    // The action row deep-links into the Actions surface.
    const link = screen.getByRole("link", { name: /Replace the refrigerator water filter/ });
    expect(link.getAttribute("href")).toBe("/actions#action-44444444-4444-4444-4444-444444444444");
    expect(screen.getByText("Detail added")).toBeTruthy();
    expect(screen.getByText("Filter size")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Jul 1")).toBeTruthy();
  });

  it("teaches the empty state", () => {
    render(<AssetHistory entries={[]} />);

    expect(screen.getByText(/Nothing has happened here yet/)).toBeTruthy();
  });
});
