import { describe, expect, it } from "vitest";
import { calendarSuggestionDedupeKey, calendarSuggestionToPromptNudge } from "./calendar-followups";

describe("calendarSuggestionDedupeKey", () => {
  it("keys distinct person signals distinctly and is collision-safe across delimiters", () => {
    const base = calendarSuggestionDedupeKey({
      providerEventId: "evt-1",
      calendarId: "primary",
      personId: "p1",
      shape: "post_meeting_followup",
    });
    const other = calendarSuggestionDedupeKey({
      providerEventId: "evt-1",
      calendarId: "primary",
      personId: "p2",
      shape: "post_meeting_followup",
    });
    expect(base).not.toBe(other);
    // A separator inside a component cannot collide two distinct signals.
    const piped = calendarSuggestionDedupeKey({
      providerEventId: "evt-1",
      calendarId: "primary",
      unresolvedAttendee: "a|b",
      shape: "post_meeting_followup",
    });
    const split = calendarSuggestionDedupeKey({
      providerEventId: "evt-1|primary",
      calendarId: "a",
      unresolvedAttendee: "b",
      shape: "post_meeting_followup",
    });
    expect(piped).not.toBe(split);
  });
});

describe("calendarSuggestionToPromptNudge", () => {
  it("maps a suggestion to a generic calendar-sourced nudge whose prompt is the reason", () => {
    const nudge = calendarSuggestionToPromptNudge({
      id: "s1",
      reason: "Follow up after coffee with Maya",
    });
    expect(nudge).toEqual({
      id: "s1",
      label: "Follow up after coffee with Maya",
      prompt: "Follow up after coffee with Maya",
      source: "calendar",
    });
  });

  it("truncates a long label but keeps the full prompt", () => {
    const reason = `Follow up ${"x".repeat(200)}`;
    const nudge = calendarSuggestionToPromptNudge({ id: "s1", reason });
    expect(nudge.label.length).toBeLessThanOrEqual(80);
    expect(nudge.label.endsWith("…")).toBe(true);
    expect(nudge.prompt).toBe(reason);
  });
});
