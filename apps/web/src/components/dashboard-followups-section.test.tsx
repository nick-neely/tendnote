import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardFollowupView } from "@/lib/followup-view";

vi.mock("@/app/actions/followups", () => ({
  completeFollowupAction: vi.fn(),
  dismissFollowupAction: vi.fn(),
}));

import { DashboardFollowupsSection } from "./dashboard-followups-section";

function view(overrides: Partial<DashboardFollowupView> = {}): DashboardFollowupView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reason: "Check in about the move.",
    status: "open",
    dueAtISO: "2026-07-04T00:00:00.000Z",
    dueAtDate: "2026-07-04",
    dueLabel: "Jul 4",
    dueState: "upcoming",
    personId: "person-1",
    personName: "Mark",
    ...overrides,
  };
}

describe("DashboardFollowupsSection", () => {
  it("renders active follow-ups with person name, reason, due state, and quick actions", () => {
    const html = renderToStaticMarkup(
      <DashboardFollowupsSection followups={[view()]} onResolve={() => {}} />,
    );

    expect(html).toContain("Follow-ups");
    expect(html).toContain("Mark");
    expect(html).toContain("Check in about the move.");
    expect(html).toContain("Due Jul 4");
    expect(html).toContain("Complete");
    expect(html).toContain("Dismiss");
    // The person is reachable by name; the raw id is never shown as content.
    expect(html).toContain('href="/people/person-1#follow-ups"');
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("hides entirely when there is nothing active (no heading)", () => {
    const html = renderToStaticMarkup(
      <DashboardFollowupsSection followups={[]} onResolve={() => {}} />,
    );

    expect(html).toBe("");
  });

  it("reads sensibly when the person could not be resolved", () => {
    const html = renderToStaticMarkup(
      <DashboardFollowupsSection followups={[view({ personName: null })]} onResolve={() => {}} />,
    );

    expect(html).toContain("Someone");
  });

  it("surfaces the snoozed status so it is distinguishable from open", () => {
    const html = renderToStaticMarkup(
      <DashboardFollowupsSection followups={[view({ status: "snoozed" })]} onResolve={() => {}} />,
    );

    expect(html).toContain("Snoozed");
  });

  it("marks past-due reminders with calm words, not guilt copy", () => {
    const html = renderToStaticMarkup(
      <DashboardFollowupsSection
        followups={[view({ dueState: "overdue", dueLabel: "Jun 20" })]}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain("Was due Jun 20");
    expect(html).not.toContain("Overdue");
  });
});
