import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BriefItemView, BriefView } from "@/lib/brief-view";

vi.mock("@/app/actions/briefs", () => ({
  dismissBriefItemAction: vi.fn(),
  snoozeBriefItemAction: vi.fn(),
  generateBriefAction: vi.fn(),
  acceptBriefFollowupAction: vi.fn(),
}));

import { DashboardBriefSection } from "./dashboard-brief-section";

function itemView(overrides: Partial<BriefItemView> = {}): BriefItemView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "due_followup",
    title: "Follow up with Mark",
    reason: "Reconnect about the move.",
    personId: "person-1",
    personName: "Mark",
    dueLabel: "Jun 27",
    dueState: "today",
    isSensitive: false,
    isSuggestedFollowup: false,
    ...overrides,
  };
}

function briefView(overrides: Partial<BriefView> = {}): BriefView {
  return { id: "brief-1", cadence: "daily", summary: null, items: [itemView()], ...overrides };
}

describe("DashboardBriefSection", () => {
  it("renders the current daily brief items with dismiss and snooze actions", () => {
    const html = renderToStaticMarkup(
      <DashboardBriefSection brief={briefView()} cadence="daily" />,
    );

    expect(html).toContain("Today&#x27;s brief");
    expect(html).toContain("Follow up with Mark");
    expect(html).toContain("Reconnect about the move.");
    expect(html).toContain("Due today");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Later");
    expect(html).toContain("Refresh");
    expect(html).toContain('href="/people/person-1"');
    // Raw ids never render as content.
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("renders the optional summary line when present and omits it when absent", () => {
    const withSummary = renderToStaticMarkup(
      <DashboardBriefSection
        brief={briefView({ summary: "A couple people to keep in mind today." })}
        cadence="daily"
      />,
    );
    expect(withSummary).toContain("A couple people to keep in mind today.");

    const withoutSummary = renderToStaticMarkup(
      <DashboardBriefSection brief={briefView({ summary: null })} cadence="daily" />,
    );
    expect(withoutSummary).not.toContain("keep in mind");
  });

  it("shows a calm empty state with a generate action when there is no brief", () => {
    const html = renderToStaticMarkup(<DashboardBriefSection brief={null} cadence="weekly" />);

    expect(html).toContain("This week");
    expect(html).toContain("No weekly review yet");
    expect(html).toContain("Generate");
    // No regenerate affordance without an existing brief.
    expect(html).not.toContain("Refresh");
  });

  it("offers Accept only on suggested-followup items", () => {
    const suggested = renderToStaticMarkup(
      <DashboardBriefSection
        brief={briefView({
          items: [itemView({ kind: "suggested_followup", isSuggestedFollowup: true })],
        })}
        cadence="daily"
      />,
    );
    expect(suggested).toContain("Accept");

    const plain = renderToStaticMarkup(
      <DashboardBriefSection brief={briefView()} cadence="daily" />,
    );
    expect(plain).not.toContain("Accept");
  });

  it("marks sensitive items so they read carefully", () => {
    const html = renderToStaticMarkup(
      <DashboardBriefSection
        brief={briefView({ items: [itemView({ isSensitive: true })] })}
        cadence="daily"
      />,
    );

    expect(html).toContain("Sensitive");
  });

  it("renders an empty state when the brief exists but all items are cleared", () => {
    const html = renderToStaticMarkup(
      <DashboardBriefSection brief={briefView({ items: [] })} cadence="daily" />,
    );

    expect(html).toContain("No brief yet");
    // An existing brief still offers regenerate.
    expect(html).toContain("Refresh");
  });
});
