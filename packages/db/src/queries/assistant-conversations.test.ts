import { describe, expect, it } from "vitest";
import {
  ASSISTANT_CONVERSATION_FALLBACK_TITLE,
  ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH,
  ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH,
  ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
  normalizeConversationTitle,
  normalizeFirstMessage,
  placeholderConversationTitle,
} from "./assistant-conversations";

describe("assistant conversation placeholder titles", () => {
  it("uses a short opening message verbatim", () => {
    expect(placeholderConversationTitle("What did Mara say about the move?")).toBe(
      "What did Mara say about the move?",
    );
  });

  it("collapses the newlines a multi-line composer produces", () => {
    expect(placeholderConversationTitle("  Draft a note\n\n  to Sam  ")).toBe(
      "Draft a note to Sam",
    );
  });

  it("cuts a long message on a word boundary and marks the cut", () => {
    const title = placeholderConversationTitle(
      "Remind me what happened the last time I saw Priya and whether I owe her anything",
    );

    expect(title).toBe("Remind me what happened the last time I saw Priya and…");
    expect([...title].length).toBeLessThanOrEqual(
      ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH + 1,
    );
  });

  it("falls back to a hard cut when the first words are one long run", () => {
    const title = placeholderConversationTitle(`${"a".repeat(80)} tail`);

    expect(title).toBe(`${"a".repeat(ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH)}…`);
  });

  it("does not leave dangling punctuation before the ellipsis", () => {
    // The word-boundary cut lands right after a comma.
    const title = placeholderConversationTitle(
      "Remember what Jordan actually told me about the wedding, then remind me",
    );

    expect(title).toBe("Remember what Jordan actually told me about the wedding…");
  });

  it("counts code points, so an emoji-heavy message is not cut mid-character", () => {
    const title = placeholderConversationTitle("🎁".repeat(80));

    expect([...title]).toHaveLength(ASSISTANT_CONVERSATION_PLACEHOLDER_TITLE_MAX_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
  });

  it("names an empty or whitespace-only opening turn rather than storing a blank title", () => {
    expect(placeholderConversationTitle("")).toBe(ASSISTANT_CONVERSATION_FALLBACK_TITLE);
    expect(placeholderConversationTitle("   \n  ")).toBe(ASSISTANT_CONVERSATION_FALLBACK_TITLE);
  });
});

describe("assistant conversation stored text", () => {
  it("keeps the opening message on one line and within the column cap", () => {
    const stored = normalizeFirstMessage(`${"word ".repeat(400)}`);

    expect(stored).not.toBeNull();
    expect([...(stored ?? "")].length).toBe(ASSISTANT_CONVERSATION_FIRST_MESSAGE_MAX_LENGTH);
    expect(stored).not.toContain("\n");
  });

  it("stores nothing for a turn that carried no text of its own", () => {
    expect(normalizeFirstMessage(null)).toBeNull();
    expect(normalizeFirstMessage(undefined)).toBeNull();
    expect(normalizeFirstMessage("  ")).toBeNull();
  });

  it("caps a title from any author and never stores an empty one", () => {
    expect([...(normalizeConversationTitle("x".repeat(500)) ?? "")]).toHaveLength(
      ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
    );
    expect(normalizeConversationTitle("   ")).toBe(ASSISTANT_CONVERSATION_FALLBACK_TITLE);
    expect(normalizeConversationTitle("  Moving\nweekend  ")).toBe("Moving weekend");
  });
});
