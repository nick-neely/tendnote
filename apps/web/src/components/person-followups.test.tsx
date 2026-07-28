import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FollowupView } from "@/lib/followup-view";

// The real actions pull in `server-only`; the surface only needs them to exist as
// callable handlers, which these render tests never fire.
vi.mock("@/app/actions/followups", () => ({
  archiveFollowupAction: vi.fn(),
  completeFollowupAction: vi.fn(),
  createFollowupAction: vi.fn(),
  dismissFollowupAction: vi.fn(),
  editFollowupAction: vi.fn(),
  reopenFollowupAction: vi.fn(),
  snoozeFollowupAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveReminderAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: () => {}, pending: false, error: null }),
}));

// The surface calls router.refresh() on mutation; static render only needs the
// hook to resolve.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { PersonFollowups } from "./person-followups";

function view(overrides: Partial<FollowupView> = {}): FollowupView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    revision: "2026-07-24T00:00:00.000Z",
    reason: "Check in about the move.",
    status: "open",
    ownerUserId: "owner-1",
    owned: true,
    dueAtISO: "2026-07-04T00:00:00.000Z",
    dueAtDate: "2026-07-04",
    dueLabel: "Jul 4",
    dueState: "upcoming",
    surfaceLabel: "Due Jul 4",
    visibilityChoice: "only_me",
    visibilityLabel: "Only me",
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof PersonFollowups>[0]> = {}) {
  return renderToStaticMarkup(
    <PersonFollowups
      active={props.active ?? []}
      defaultDueDate="2026-06-27"
      firstName={props.firstName ?? "Mark"}
      personId="person-1"
      resolved={props.resolved ?? []}
    />,
  );
}

describe("PersonFollowups", () => {
  it("renders active follow-ups with reason and management actions", () => {
    const html = render({ active: [view()] });

    expect(html).toContain("Check in about the move.");
    expect(html).toContain('id="followup-11111111-1111-1111-1111-111111111111"');
    expect(html).toContain("Only me");
    expect(html).toContain("Complete");
    expect(html).toContain("More actions");
    expect(html).toContain("New follow-up");
    // The id may be an invisible deep-link target, but is never rendered as text.
    expect(html).not.toContain(">11111111-1111-1111-1111-111111111111<");
  });

  it("shows an empty state naming the person when there are no active follow-ups", () => {
    const html = render({ active: [], firstName: "Mark" });

    expect(html).toContain("No active follow-ups");
    expect(html).toContain("follow-ups for Mark");
  });

  it("marks past-due follow-ups with calm words, not guilt copy or color alone", () => {
    const html = render({
      active: [
        view({
          dueState: "overdue",
          dueLabel: "Jun 20",
          surfaceLabel: "Was due Jun 20",
        }),
      ],
    });

    expect(html).toContain("Was due Jun 20");
    // Calm by design: no guilt language (DESIGN.md §9).
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain("Missed");
  });

  it("marks follow-ups due today", () => {
    const html = render({
      active: [view({ dueState: "today", surfaceLabel: "Due today" })],
    });

    expect(html).toContain("Due today");
  });

  it("keeps resolved follow-ups in a quiet reopen-able list", () => {
    const html = render({
      active: [],
      resolved: [view({ status: "completed", reason: "Sent the photos." })],
    });

    expect(html).toContain("Resolved (1)");
    expect(html).toContain("Sent the photos.");
    expect(html).toContain("Reopen");
  });

  it("does not render resolved chrome when nothing is resolved", () => {
    const html = render({ active: [view()], resolved: [] });

    expect(html).not.toContain("Resolved (");
  });

  it("renders household member sharing choices when members are available", () => {
    const html = renderToStaticMarkup(
      <PersonFollowups
        active={[]}
        defaultDueDate="2026-06-27"
        firstName="Mark"
        personId="person-1"
        resolved={[]}
        shareableMembers={[{ userId: "user-2", name: "Nina", email: "nina@example.com" }]}
      />,
    );

    expect(html).toContain("New follow-up");
    // The form starts collapsed, so member details are only exposed after the
    // user opens creation.
    expect(html).not.toContain("nina@example.com");
  });
});
