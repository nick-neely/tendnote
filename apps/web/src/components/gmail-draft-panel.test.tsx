import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DraftView } from "@/lib/draft-view";
import type { GmailDraftView } from "@/lib/gmail-draft-view";

vi.mock("@/app/actions/gmail-drafts", () => ({
  createGmailDraftAction: vi.fn(),
  updateGmailDraftAction: vi.fn(),
  retryGmailDraftAction: vi.fn(),
}));

import { GmailDraftPanel } from "./gmail-draft-panel";

const DRAFT: DraftView = {
  id: "11111111-1111-1111-1111-111111111111",
  personId: "p1",
  status: "approved",
  statusLabel: "Approved",
  channel: "email",
  purpose: "check_in",
  body: "Hey Casey, good to reconnect.",
  editable: true,
  grounding: [],
  createdAt: "2026-06-27T00:00:00.000Z",
  updatedAt: "2026-06-27T00:00:00.000Z",
};

function render(props: Partial<Parameters<typeof GmailDraftPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <GmailDraftPanel
      connected
      draft={DRAFT}
      initialView={null}
      personEmails={[]}
      personName="Casey"
      {...props}
    />,
  );
}

const succeeded: GmailDraftView = {
  actionId: "a1",
  status: "succeeded",
  kind: "create",
  gmailDraftId: "g1",
  subject: "Checking in, Casey",
  recipientEmail: "casey@example.com",
  error: null,
};

describe("GmailDraftPanel", () => {
  it("prompts to connect Gmail when it is not connected", () => {
    const html = render({ connected: false });
    expect(html).toContain("Connect Gmail");
    expect(html).not.toContain("Save to Gmail");
  });

  it("offers a Save-to-Gmail affordance for a connected, approved draft", () => {
    const html = render();
    expect(html).toContain("Save to Gmail");
  });

  it("shows the last known Gmail state after a successful create, never claiming a send", () => {
    const html = render({ initialView: succeeded });
    expect(html).toContain("Saved as a Gmail draft");
    expect(html).toContain("casey@example.com");
    // No send language (ADR-0089): it tells the user to send from Gmail themselves.
    expect(html).toContain("Send it yourself from Gmail");
    expect(html.toLowerCase()).not.toContain("sent to");
    // Explicit update intent is offered for a linked draft (ADR-0088).
    expect(html).toContain("Update in Gmail");
  });

  it("does not offer an update affordance once Gmail is disconnected", () => {
    const html = render({ connected: false, initialView: succeeded });
    expect(html).toContain("Saved as a Gmail draft");
    expect(html).not.toContain("Update in Gmail");
  });

  it("shows a visible retry after a failed create", () => {
    const html = render({
      initialView: { ...succeeded, status: "failed", gmailDraftId: null, error: "gmail 503" },
    });
    expect(html).toContain("Couldn");
    expect(html).toContain("Retry");
  });
});
