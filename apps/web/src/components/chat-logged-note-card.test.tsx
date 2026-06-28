import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The real actions pull in `server-only`; the card only needs them to exist as
// callable functions for its click handlers, which these render tests never fire.
vi.mock("@/app/actions/logged-notes", () => ({
  approveLoggedNoteAction: vi.fn(),
  dismissLoggedNoteAction: vi.fn(),
}));

import { ChatLoggedNoteCard } from "./chat-logged-note-card";

describe("ChatLoggedNoteCard (interactive in-chat logged note)", () => {
  it("renders a neutral logged note with inline approve and dismiss, linking the person", () => {
    const html = renderToStaticMarkup(
      <ChatLoggedNoteCard
        view={{
          kind: "saved_source_record",
          sourceRecordId: "source-1",
          content: "Had lunch with Mark, he might be switching jobs.",
          linkedPersonId: "person-1",
        }}
      />,
    );

    // Logged context rests neutral (not "Ready to review"), but is actionable.
    expect(html).toContain("Logged");
    expect(html).not.toContain("Ready to review");
    expect(html).toContain("You noted:");
    expect(html).toContain("Had lunch with Mark, he might be switching jobs.");
    expect(html).toContain("Approve");
    expect(html).toContain("Dismiss");
    expect(html).toContain("approve to keep the memories from it");
    expect(html).toContain('href="/people/person-1"');
    // The raw record id is never shown as content.
    expect(html).not.toContain("source-1>");
  });
});
