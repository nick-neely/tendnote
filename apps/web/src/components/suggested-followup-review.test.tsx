import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

vi.mock("@/app/actions/suggested-followups", () => ({
  acceptSuggestedFollowupAction: vi.fn(),
  dismissSuggestedFollowupAction: vi.fn(),
  editSuggestedFollowupAction: vi.fn(),
}));

vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: () => {}, pending: false, error: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SuggestedFollowupReviewSection } from "./suggested-followup-review";

function view(overrides: Partial<SuggestedFollowupReviewView> = {}): SuggestedFollowupReviewView {
  return {
    component: {
      type: "suggested_followup_review",
      followupId: "11111111-1111-1111-1111-111111111111",
      sourceRecordId: "22222222-2222-2222-2222-222222222222",
    },
    personId: "person-1",
    personName: "Mark",
    followup: {
      id: "11111111-1111-1111-1111-111111111111",
      reason: "Check in about the new job.",
      status: "suggested",
      dueAtISO: "2026-07-15T00:00:00.000Z",
      dueAtDate: "2026-07-15",
      dueLabel: "Jul 15",
      dueState: "upcoming",
    },
    source: {
      id: "22222222-2222-2222-2222-222222222222",
      content: "Had lunch with Mark; he starts a new job in July.",
      sourceType: "manual",
      capturedAt: "2026-06-27T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("SuggestedFollowupReviewSection (person ledger)", () => {
  it("renders a tentative suggested follow-up with source grounding and review actions", () => {
    const html = renderToStaticMarkup(<SuggestedFollowupReviewSection initialReviews={[view()]} />);

    expect(html).toContain("Suggested follow-up");
    expect(html).toContain("for Mark");
    expect(html).toContain("Check in about the new job.");
    expect(html).toContain("Proposed for Jul 15");
    expect(html).toContain("From manual note");
    expect(html).toContain("Accept");
    expect(html).toContain("Edit");
    expect(html).toContain("Dismiss");
    // The draft entry point is a distinct control from Accept: drafting from a
    // review point never accepts the suggestion or creates follow-up state (#79).
    expect(html).toContain("Draft");
    // Tentative until accepted.
    expect(html).toContain("Nothing becomes a reminder until you accept");
    // Raw ids are never shown to the user.
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
    expect(html).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("renders nothing when there is nothing to review", () => {
    const html = renderToStaticMarkup(<SuggestedFollowupReviewSection initialReviews={[]} />);

    expect(html).toBe("");
  });
});
