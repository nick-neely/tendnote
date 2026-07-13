// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AssetRelatedActionView } from "@/lib/asset-related-action-view";
import { render, screen } from "@/test/dom";

/**
 * DOM behavior for the Asset Profile's minimal related-actions section (#199):
 * linked General Actions render as calm ledger rows that deep-link back into the
 * Actions surface, resolved actions read as history, and the empty state teaches
 * where rows will come from.
 */

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { AssetRelatedActions } from "./asset-related-actions";

function relatedAction(overrides: Partial<AssetRelatedActionView> = {}): AssetRelatedActionView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Replace the refrigerator water filter",
    recurrenceLabel: "Every 6 months",
    metaLabel: "Due Jul 12",
    resolved: false,
    ...overrides,
  };
}

describe("AssetRelatedActions (#199)", () => {
  it("renders a linked routine with its cadence, timing, and a deep link to the row", () => {
    render(<AssetRelatedActions actions={[relatedAction()]} />);

    const link = screen.getByRole("link", { name: /Replace the refrigerator water filter/ });
    expect(link.getAttribute("href")).toBe("/actions#action-11111111-1111-1111-1111-111111111111");
    expect(screen.getByText("Every 6 months")).toBeTruthy();
    expect(screen.getByText("Due Jul 12")).toBeTruthy();
  });

  it("renders a resolved action as quiet history", () => {
    render(
      <AssetRelatedActions
        actions={[
          relatedAction({
            id: "33333333-3333-3333-3333-333333333333",
            title: "Order the first filter",
            recurrenceLabel: null,
            metaLabel: "Completed",
            resolved: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Completed")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Order the first filter/ });
    expect(link.getAttribute("data-resolved")).toBe("true");
  });

  it("teaches where related actions come from when there are none", () => {
    render(<AssetRelatedActions actions={[]} />);

    expect(screen.getByText(/No related actions yet/)).toBeTruthy();
  });
});
