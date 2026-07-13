// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetHistoryEntryView } from "@/lib/asset-history-view";
import { render, screen } from "@/test/dom";

/**
 * DOM behavior for the Asset Profile's derived History section (#202): each row
 * is a calm label + record + date, and a row whose record lives on another
 * surface deep-links to it — the action in Actions, a linked asset's profile —
 * because history retells records and never owns them (#196).
 */

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetHistory } from "./asset-history";

function entry(overrides: Partial<AssetHistoryEntryView> = {}): AssetHistoryEntryView {
  return {
    id: "asset-e1",
    label: "Added",
    detail: null,
    detailHref: null,
    atISO: "2026-07-01T12:00:00.000Z",
    atLabel: "Jul 1",
    ...overrides,
  };
}

describe("AssetHistory (#202)", () => {
  it("renders lifecycle, detail, evidence, link, and action rows with their dates", () => {
    render(
      <AssetHistory
        entries={[
          entry({
            id: "action-a1",
            label: "Completed",
            detail: "Replace the refrigerator water filter",
            detailHref: "/actions#action-44444444-4444-4444-4444-444444444444",
            atLabel: "Jul 10",
          }),
          entry({
            id: "asset-link-l1",
            label: "Linked",
            detail: "fits Refrigerator",
            detailHref: "/assets/22222222-2222-2222-2222-222222222222",
            atLabel: "Jul 5",
          }),
          entry({
            id: "evidence-ev1",
            label: "Receipt attached",
            detail: "Costco receipt",
            atLabel: "Jul 4",
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

    // Rows whose record has a surface of its own hop to it.
    const action = screen.getByRole("link", { name: /Replace the refrigerator water filter/ });
    expect(action.getAttribute("href")).toBe(
      "/actions#action-44444444-4444-4444-4444-444444444444",
    );
    const link = screen.getByRole("link", { name: /fits Refrigerator/ });
    expect(link.getAttribute("href")).toBe("/assets/22222222-2222-2222-2222-222222222222");

    // Evidence and confirmed details read as plain moments, no hop needed.
    expect(screen.getByText("Receipt attached")).toBeTruthy();
    expect(screen.getByText("Costco receipt")).toBeTruthy();
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
