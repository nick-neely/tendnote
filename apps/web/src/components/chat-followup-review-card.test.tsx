import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SuggestedFollowupReviewItemView } from "@/lib/eve/tool-result-view";

vi.mock("@/app/actions/suggested-followups", () => ({
  acceptSuggestedFollowupAction: vi.fn(),
  dismissSuggestedFollowupAction: vi.fn(),
}));

import { ChatFollowupReviewCard, ChatFollowupReviewList } from "./chat-followup-review-card";

function item(
  overrides: Partial<SuggestedFollowupReviewItemView> = {},
): SuggestedFollowupReviewItemView {
  return {
    followupId: "11111111-1111-1111-1111-111111111111",
    reason: "Check in about the new job.",
    timingLabel: "Was due Jul 15",
    sourceRecordId: "s1",
    personId: "person-1",
    personName: "Mark",
    ...overrides,
  };
}

describe("ChatFollowupReviewCard (interactive in-chat review)", () => {
  it("renders a tentative suggested follow-up with inline accept and dismiss, naming the person", () => {
    const html = renderToStaticMarkup(<ChatFollowupReviewCard item={item()} />);

    expect(html).toContain("Ready to review");
    expect(html).toContain("Tentative. No reminder until you accept.");
    expect(html).toContain("Suggested follow-up for Mark:");
    expect(html).toContain("Check in about the new job.");
    expect(html).toContain("Was due Jul 15");
    expect(html).not.toContain("Proposed for");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
    expect(html).toContain('href="/people/person-1#follow-ups"');
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("reads sensibly when the person could not be resolved", () => {
    const html = renderToStaticMarkup(<ChatFollowupReviewCard item={item({ personName: null })} />);

    expect(html).toContain("Suggested follow-up:");
    expect(html).not.toContain("Suggested follow-up for");
  });
});

describe("ChatFollowupReviewList", () => {
  it("renders an interactive card per suggestion", () => {
    const html = renderToStaticMarkup(
      <ChatFollowupReviewList
        view={{
          kind: "suggested_followup_review_list",
          reviews: [
            item(),
            item({ followupId: "f2", reason: "Send the photos.", personName: "Dana" }),
          ],
        }}
      />,
    );

    expect(html).toContain("Check in about the new job.");
    expect(html).toContain("Send the photos.");
    expect(html).toContain("Dana");
  });

  it("renders nothing for an empty list", () => {
    const html = renderToStaticMarkup(
      <ChatFollowupReviewList view={{ kind: "suggested_followup_review_list", reviews: [] }} />,
    );

    expect(html).toBe("");
  });
});
