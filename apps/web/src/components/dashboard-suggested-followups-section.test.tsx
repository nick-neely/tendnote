import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

vi.mock("@/app/actions/suggested-followups", () => ({
  acceptSuggestedFollowupAction: vi.fn(),
  dismissSuggestedFollowupAction: vi.fn(),
}));

import { DashboardSuggestedFollowupsSection } from "./dashboard-suggested-followups-section";

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
    source: null,
    ...overrides,
  };
}

describe("DashboardSuggestedFollowupsSection (dashboard rail)", () => {
  it("renders a compact reviewable suggestion with accept/dismiss linking to the person", () => {
    const html = renderToStaticMarkup(
      <DashboardSuggestedFollowupsSection reviews={[view()]} onResolve={() => {}} />,
    );

    expect(html).toContain("Follow-ups to review");
    expect(html).toContain("Mark");
    expect(html).toContain("Check in about the new job.");
    expect(html).toContain("Proposed for Jul 15");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
    expect(html).toContain('href="/people/person-1#follow-ups"');
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("hides entirely when nothing is waiting (no heading)", () => {
    const html = renderToStaticMarkup(
      <DashboardSuggestedFollowupsSection reviews={[]} onResolve={() => {}} />,
    );

    expect(html).toBe("");
  });

  it("reads sensibly when the person could not be resolved", () => {
    const html = renderToStaticMarkup(
      <DashboardSuggestedFollowupsSection
        reviews={[view({ personName: null })]}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain("Someone");
  });
});
