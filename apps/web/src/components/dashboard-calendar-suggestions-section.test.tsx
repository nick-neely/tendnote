import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";

vi.mock("@/app/actions/suggested-followups", () => ({
  acceptCalendarSuggestedFollowupAction: vi.fn(),
  dismissCalendarSuggestedFollowupAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { DashboardCalendarSuggestionsSection } from "./dashboard-calendar-suggestions-section";

function view(overrides: Partial<CalendarSuggestionReviewView> = {}): CalendarSuggestionReviewView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    personId: "person-1",
    personName: "Maya Chen",
    unresolvedAttendee: null,
    matchKind: "email",
    tentative: false,
    reason: "Follow up after Coffee with Maya with Maya Chen",
    dueAtISO: "2026-07-01T00:00:00.000Z",
    dueAtDate: "2026-07-01",
    dueLabel: "Jul 1",
    dueState: "upcoming",
    ...overrides,
  };
}

describe("DashboardCalendarSuggestionsSection", () => {
  it("renders resolved Calendar suggestions as explicit review cards", () => {
    const html = renderToStaticMarkup(
      <DashboardCalendarSuggestionsSection onResolve={() => {}} suggestions={[view()]} />,
    );

    expect(html).toContain("From calendar");
    expect(html).toContain("Maya Chen");
    expect(html).toContain("Follow up after Coffee with Maya");
    expect(html).toContain("Provider-derived context, not saved memory");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
    expect(html).toContain('href="/people/person-1#follow-ups"');
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("explains unresolved attendees cannot be accepted yet", () => {
    const html = renderToStaticMarkup(
      <DashboardCalendarSuggestionsSection
        onResolve={() => {}}
        suggestions={[
          view({
            personId: null,
            personName: null,
            unresolvedAttendee: "maya@example.com",
            matchKind: "unresolved",
          }),
        ]}
      />,
    );

    expect(html).toContain("maya@example.com");
    expect(html).toContain("Link this attendee to a person before accepting");
    expect(html).toContain("disabled");
  });

  it("hides entirely when there are no Calendar suggestions", () => {
    expect(
      renderToStaticMarkup(
        <DashboardCalendarSuggestionsSection onResolve={() => {}} suggestions={[]} />,
      ),
    ).toBe("");
  });
});
