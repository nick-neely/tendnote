import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DraftView } from "@/lib/draft-view";
import type { GmailDraftContext } from "./person-drafts";

vi.mock("@/app/actions/drafts", () => ({
  approveDraftAction: vi.fn(),
  dismissDraftAction: vi.fn(),
  editDraftBodyAction: vi.fn(),
  markDraftSentManuallyAction: vi.fn(),
  regenerateDraftAction: vi.fn(),
}));

// The Gmail panel imports server actions that reach `server-only`; stub them so the
// approved-draft card renders client-side in this static test.
vi.mock("@/app/actions/gmail-drafts", () => ({
  createGmailDraftAction: vi.fn(),
  retryGmailDraftAction: vi.fn(),
}));

function gmailContext(overrides: Partial<GmailDraftContext> = {}): GmailDraftContext {
  return { connected: false, personName: "Mark", personEmails: [], byDraftId: {}, ...overrides };
}

// The entry-point button uses a router-backed hook; stub it so static rendering
// needs no Next.js router context.
vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: vi.fn(), pending: false, error: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { PersonDrafts } from "./person-drafts";

const PERSON_ID = "person-1";

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
  it("renders a draft with status, body, a grounding disclosure, and review actions", () => {
    const html = renderToStaticMarkup(
      <PersonDrafts gmail={gmailContext()} initialDrafts={[view()]} personId={PERSON_ID} />,
    );

    expect(html).toContain("Draft");
    expect(html).toContain("heard you moved to Denver");
    // Grounding and the Tendnote-only reassurance now live behind the shared
    // "About this draft" disclosure (the popover content renders only when opened),
    // so the draft itself leads instead of a wall of provenance.
    expect(html).toContain("About this draft");
    expect(html).toContain("Copy");
    expect(html).toContain("Edit");
    expect(html).toContain("Regenerate");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Approve");
    expect(html).toContain("Mark sent");
    // Raw ids are never user-facing copy.
    expect(html).not.toContain("33333333-3333-3333-3333-333333333333");
  });

  it("hides edit/lifecycle actions for a terminal (sent) draft but still allows copy", () => {
    const html = renderToStaticMarkup(
      <PersonDrafts
        gmail={gmailContext()}
        initialDrafts={[
          view({ status: "sent_manually", statusLabel: "Sent manually", editable: false }),
        ]}
        personId={PERSON_ID}
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
      <PersonDrafts
        gmail={gmailContext()}
        initialDrafts={[view({ status: "approved", statusLabel: "Approved" })]}
        personId={PERSON_ID}
      />,
    );

    expect(html).toContain("Approved");
    expect(html).not.toContain(">Approve<");
    // Still actionable: can be marked sent manually or dismissed.
    expect(html).toContain("Mark sent");
  });

  it("renders an empty state when there are no drafts", () => {
    const html = renderToStaticMarkup(
      <PersonDrafts gmail={gmailContext()} initialDrafts={[]} personId={PERSON_ID} />,
    );

    expect(html).toContain("No message drafts yet");
  });
});
