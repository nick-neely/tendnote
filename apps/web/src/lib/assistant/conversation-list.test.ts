import { describe, expect, it } from "vitest";
import {
  assistantConversationBucket,
  groupAssistantConversations,
} from "@/lib/assistant/conversation-list";

/** Mid-afternoon, so "yesterday at 11pm" and "today at 1am" are both a few hours away. */
const NOW = new Date(2026, 8, 2, 15, 30);

function at(year: number, month: number, day: number, hour = 0, minute = 0) {
  return { lastActivityAt: new Date(year, month, day, hour, minute) };
}

describe("assistant conversation buckets", () => {
  it("sections by calendar day rather than elapsed hours", () => {
    // 16 hours apart, but on either side of midnight.
    expect(assistantConversationBucket(new Date(2026, 8, 2, 1, 0), NOW)).toBe("today");
    expect(assistantConversationBucket(new Date(2026, 8, 1, 23, 0), NOW)).toBe("yesterday");
  });

  it("keeps the previous week distinct from the older tail", () => {
    expect(assistantConversationBucket(new Date(2026, 7, 31, 12, 0), NOW)).toBe("previous7Days");
    // Six days back is the last day inside the window.
    expect(assistantConversationBucket(new Date(2026, 7, 27, 0, 1), NOW)).toBe("previous7Days");
    // Seven days back has fallen out of it.
    expect(assistantConversationBucket(new Date(2026, 7, 26, 23, 59), NOW)).toBe("older");
    expect(assistantConversationBucket(new Date(2025, 0, 1), NOW)).toBe("older");
  });

  it("puts a future-dated row with today rather than nowhere", () => {
    expect(assistantConversationBucket(new Date(2026, 8, 3, 9, 0), NOW)).toBe("today");
  });
});

describe("grouping the conversation rail", () => {
  it("returns only the sections that have conversations, in reading order", () => {
    const groups = groupAssistantConversations(
      [at(2026, 8, 2, 14, 0), at(2026, 8, 1, 9, 0), at(2025, 5, 1, 9, 0)],
      NOW,
    );

    expect(groups.map((group) => [group.id, group.label, group.conversations.length])).toEqual([
      ["today", "Today", 1],
      ["yesterday", "Yesterday", 1],
      ["older", "Older", 1],
    ]);
  });

  it("preserves the order the query returned inside each section", () => {
    const first = at(2026, 8, 2, 14, 0);
    const second = at(2026, 8, 2, 9, 0);
    const third = at(2026, 8, 2, 8, 0);

    const [today] = groupAssistantConversations([first, second, third], NOW);

    expect(today?.conversations).toEqual([first, second, third]);
  });

  it("returns nothing at all for an empty list", () => {
    expect(groupAssistantConversations([], NOW)).toEqual([]);
  });
});
