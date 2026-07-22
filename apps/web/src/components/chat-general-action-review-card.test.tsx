import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SuggestedGeneralActionReviewItemView } from "@/lib/eve/tool-result-view";

// The real actions pull in `server-only`; the card only needs them to exist as
// callable functions for its click handlers, which these SSR render tests never fire.
vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: vi.fn(),
  dismissSuggestedGeneralActionAction: vi.fn(),
}));

import {
  ChatGeneralActionReviewCard,
  ChatGeneralActionReviewList,
} from "./chat-general-action-review-card";

function item(
  overrides: Partial<SuggestedGeneralActionReviewItemView> = {},
): SuggestedGeneralActionReviewItemView {
  return {
    generalActionId: "11111111-1111-1111-1111-111111111111",
    title: "Book the campsite for the trip",
    status: "suggested",
    dueLabel: "Jul 15, 2026",
    isRoutine: false,
    recurrenceLabel: null,
    personNames: [],
    visibilityLabel: "Only me",
    ...overrides,
  };
}

describe("ChatGeneralActionReviewCard (interactive in-chat review)", () => {
  it("renders a tentative suggested action with inline accept and dismiss, no raw id", () => {
    const html = renderToStaticMarkup(<ChatGeneralActionReviewCard item={item()} />);

    expect(html).toContain("Ready to review");
    expect(html).toContain("Tentative. Not on your list until you accept.");
    // People are context links, never the subject — the lead is not "for someone".
    expect(html).toContain("Suggested action:");
    expect(html).not.toContain("Suggested action for");
    expect(html).toContain("Book the campsite for the trip");
    expect(html).toContain("Proposed for Jul 15, 2026");
    expect(html).toContain("Only me");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
    // The Open link deep-links the exact ledger row (scroll-and-pulse), and names its
    // destination since the card's subject is not a person.
    expect(html).toContain('href="/actions#action-11111111-1111-1111-1111-111111111111"');
    expect(html).toContain("Open in Actions");
    // The id appears only inside that deep-link href — never as visible card content.
    expect(html.split("11111111-1111-1111-1111-111111111111")).toHaveLength(2);
  });

  it("frames a routine proposal by its cadence and links people on the meta line", () => {
    const html = renderToStaticMarkup(
      <ChatGeneralActionReviewCard
        item={item({
          title: "Change the furnace filter",
          isRoutine: true,
          recurrenceLabel: "Every 6 months",
          dueLabel: null,
          personNames: ["Sam"],
        })}
      />,
    );

    expect(html).toContain("Suggested routine:");
    expect(html).toContain("Change the furnace filter");
    expect(html).toContain("Every 6 months");
    expect(html).toContain("With Sam");
  });
});

describe("ChatGeneralActionReviewList", () => {
  it("renders an interactive card per proposed step", () => {
    const html = renderToStaticMarkup(
      <ChatGeneralActionReviewList
        view={{
          kind: "suggested_general_action_review_list",
          reviews: [
            item(),
            item({ generalActionId: "ga-2", title: "Rent the gear", dueLabel: null }),
          ],
        }}
      />,
    );

    expect(html).toContain("Book the campsite for the trip");
    expect(html).toContain("Rent the gear");
  });

  it("renders nothing for an empty list", () => {
    const html = renderToStaticMarkup(
      <ChatGeneralActionReviewList
        view={{ kind: "suggested_general_action_review_list", reviews: [] }}
      />,
    );

    expect(html).toBe("");
  });
});
