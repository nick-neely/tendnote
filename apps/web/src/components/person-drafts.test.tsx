import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DraftView } from "@/lib/draft-view";

vi.mock("@/app/actions/drafts", () => ({
  approveDraftAction: vi.fn(),
  dismissDraftAction: vi.fn(),
  editDraftBodyAction: vi.fn(),
  markDraftSentManuallyAction: vi.fn(),
  regenerateDraftAction: vi.fn(),
}));

import { PersonDrafts } from "./person-drafts";

function view(overrides: Partial<DraftView> = {}): DraftView {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    personId: "person-1",
    status: "draft",
    statusLabel: "Draft",
    channel: "text",
    purpose: "check_in",
    body: "Hey Mark — heard you moved to Denver, how's the new place?",
    editable: true,
    grounding: [
      {
        kind: "approved_memory",
        trust: "confirmed_fact",
        trustLabel: "Confirmed",
        label: "Moved to Denver",
      },
      {
        kind: "suggested_memory",
        trust: "tentative",
        trustLabel: "Unconfirmed",
        label: "Might run marathons",
      },
    ],
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("PersonDrafts", () => {
  it("renders a draft with status, body, grounding summary, and review actions", () => {
    const html = renderToStaticMarkup(<PersonDrafts initialDrafts={[view()]} />);

    expect(html).toContain("Draft");
    expect(html).toContain("heard you moved to Denver");
    expect(html).toContain("Why this draft was written");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Moved to Denver");
    expect(html).toContain("Copy");
    expect(html).toContain("Edit");
    expect(html).toContain("Regenerate");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Approve");
    expect(html).toContain("Mark sent");
    // Reinforces the Tendnote-only boundary.
    expect(html).toContain("Nothing is sent or created outside Tendnote");
    // Raw ids are never user-facing copy.
    expect(html).not.toContain("33333333-3333-3333-3333-333333333333");
  });

  it("hides edit/lifecycle actions for a terminal (sent) draft but still allows copy", () => {
    const html = renderToStaticMarkup(
      <PersonDrafts
        initialDrafts={[
          view({ status: "sent_manually", statusLabel: "Sent manually", editable: false }),
        ]}
      />,
    );

    expect(html).toContain("Sent manually");
    expect(html).toContain("Copy");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Mark sent");
    expect(html).not.toContain("Regenerate");
  });

  it("does not show an Approve action once a draft is approved", () => {
    const html = renderToStaticMarkup(
      <PersonDrafts initialDrafts={[view({ status: "approved", statusLabel: "Approved" })]} />,
    );

    expect(html).toContain("Approved");
    expect(html).not.toContain(">Approve<");
    // Still actionable: can be marked sent manually or dismissed.
    expect(html).toContain("Mark sent");
  });

  it("renders an empty state when there are no drafts", () => {
    const html = renderToStaticMarkup(<PersonDrafts initialDrafts={[]} />);

    expect(html).toContain("No message drafts yet");
  });
});
