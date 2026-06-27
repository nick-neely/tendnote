import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The real actions pull in `server-only`; the card only needs them to exist as
// callable functions for its click handlers, which these render tests never fire.
vi.mock("@/app/actions/memory-review", () => ({
  saveSuggestedMemoryAction: vi.fn(),
  dismissSuggestedMemoryAction: vi.fn(),
}));

import { ChatReviewCard, ChatReviewList } from "./chat-review-card";

function render(personName: string | null) {
  return renderToStaticMarkup(
    <ChatReviewCard
      item={{
        memoryId: "memory-2",
        content: "Might have a girls night next week.",
        sourceRecordId: "source-2",
        personId: "person-1",
        personName,
      }}
    />,
  );
}

describe("ChatReviewCard (interactive in-chat review)", () => {
  it("renders a tentative suggestion with inline approve and dismiss, naming the person not an id", () => {
    const html = render("Juli");

    expect(html).toContain("Ready to review");
    expect(html).toContain("Tentative — not saved until you approve it");
    expect(html).toContain("Suggested for Juli:");
    expect(html).toContain("Might have a girls night next week.");
    // The actions are present in the initial (pending) render.
    expect(html).toContain("Approve");
    expect(html).toContain("Dismiss");
    // The person is reachable by name; the raw id is never shown as content.
    expect(html).toContain('href="/people/person-1#needs-review"');
    expect(html).not.toContain("memory-2");
  });

  it("still reads sensibly when the person could not be resolved", () => {
    const html = render(null);

    expect(html).toContain("Ready to review");
    expect(html).toContain("Suggested:");
    expect(html).not.toContain("Suggested for");
  });
});

describe("ChatReviewList (the 'anything to review?' result)", () => {
  it("renders an interactive card per open suggestion", () => {
    const html = renderToStaticMarkup(
      <ChatReviewList
        view={{
          kind: "suggested_memory_review_list",
          reviews: [
            {
              memoryId: "m1",
              content: "Might have a girls night next week.",
              sourceRecordId: "s1",
              personId: "person-1",
              personName: "Juli",
            },
            {
              memoryId: "m2",
              content: "Mentioned a new manager at work.",
              sourceRecordId: "s2",
              personId: "person-2",
              personName: "Mark",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Might have a girls night next week.");
    expect(html).toContain("Mentioned a new manager at work.");
    expect(html).toContain("Suggested for Juli:");
    expect(html).toContain("Suggested for Mark:");
    // One approve control per suggestion, each scoped to its own person.
    expect(html).toContain("Approve suggestion for Juli");
    expect(html).toContain("Approve suggestion for Mark");
  });

  it("renders nothing when there is nothing to review", () => {
    const html = renderToStaticMarkup(
      <ChatReviewList view={{ kind: "suggested_memory_review_list", reviews: [] }} />,
    );

    expect(html).toBe("");
  });
});
