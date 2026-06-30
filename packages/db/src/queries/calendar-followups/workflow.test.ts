import type { CalendarEventSummary } from "@tendnote/domain";
import { calendarSuggestionToPromptNudge } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import type { CalendarReader, OwnerCalendarReadOutcome } from "../calendar";
import type { CalendarReadRequest } from "../calendar/types";
import { createInMemoryCalendarSuggestionStore } from "./in-memory-store";
import { createCalendarSuggestionReview } from "./suggestions";
import type { CalendarPeopleMatcher } from "./types";
import { createCalendarSuggestionWorkflow } from "./workflow";

const OWNER = "owner-1";
const NOW = new Date("2026-06-30T16:00:00.000Z");

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: overrides.calendarId ?? "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-30T15:00:00.000Z"),
    end: overrides.end ?? new Date("2026-06-30T15:30:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: overrides.status ?? "confirmed",
    attendees: overrides.attendees ?? [
      {
        email: "maya@example.com",
        displayName: "Maya Chen",
        responseStatus: "accepted",
        self: false,
        organizer: false,
      },
    ],
    location: overrides.location ?? null,
    description: overrides.description ?? null,
    updatedAt: overrides.updatedAt ?? null,
  };
}

function matcher(): CalendarPeopleMatcher {
  return {
    findPeopleByEmail: async (_ownerUserId, email) =>
      email === "maya@example.com" ? [{ id: "person-1", displayName: "Maya Chen" }] : [],
    findPeopleByName: async () => [],
  };
}

function setup(outcome: OwnerCalendarReadOutcome) {
  const store = createInMemoryCalendarSuggestionStore();
  const read = vi.fn<
    (
      input: CalendarReadRequest,
      deps: {
        reader: CalendarReader;
      },
    ) => Promise<OwnerCalendarReadOutcome>
  >(async () => outcome);
  const workflow = createCalendarSuggestionWorkflow({
    readerFor: () => ({
      readCalendarEvents: async () => {
        throw new Error("Injected read should own workflow tests.");
      },
    }),
    review: createCalendarSuggestionReview(store),
    matcher: matcher(),
    read,
  });
  return { store, workflow, read };
}

describe("createCalendarSuggestionWorkflow", () => {
  it("reads a bounded Calendar window and persists prompt-nudgeable suggestions", async () => {
    const { store, workflow, read } = setup({
      connected: true,
      result: {
        events: [event({ description: "raw-ish text should not enter the suggestion" })],
        source: "live",
        stale: false,
        fetchedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 300_000),
      },
    });

    const result = await workflow.runCalendarSuggestionWorkflow({ ownerUserId: OWNER, now: NOW });

    expect(result).toEqual({ connected: true, generated: 1 });
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: OWNER,
      providerKey: "google",
      capabilityKey: "calendar",
      calendarId: "primary",
      maxResults: 25,
      query: null,
    });
    const request = read.mock.calls[0]?.[0];
    expect(request?.timeMin.getTime()).toBeLessThan(NOW.getTime());
    expect(request?.timeMax.getTime()).toBeGreaterThan(NOW.getTime());

    const suggestions = await store.listSuggestions({ ownerUserId: OWNER, status: "suggested" });
    expect(suggestions).toHaveLength(1);
    const suggestion = suggestions[0];
    expect(suggestion).toMatchObject({
      ownerUserId: OWNER,
      personId: "person-1",
      status: "suggested",
      reason: "Follow up after Coffee with Maya with Maya Chen",
    });
    expect(Object.keys(suggestion ?? {})).not.toContain("description");
    if (!suggestion) {
      throw new Error("Expected a persisted suggestion.");
    }
    expect(calendarSuggestionToPromptNudge(suggestion)).toMatchObject({
      source: "calendar",
      prompt: "Follow up after Coffee with Maya with Maya Chen",
    });
  });

  it("dedupes repeated workflow runs through the suggestion store", async () => {
    const { workflow } = setup({
      connected: true,
      result: {
        events: [event()],
        source: "live",
        stale: false,
        fetchedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 300_000),
      },
    });

    await expect(
      workflow.runCalendarSuggestionWorkflow({ ownerUserId: OWNER, now: NOW }),
    ).resolves.toEqual({ connected: true, generated: 1 });
    await expect(
      workflow.runCalendarSuggestionWorkflow({ ownerUserId: OWNER, now: NOW }),
    ).resolves.toEqual({ connected: true, generated: 0 });
  });

  it("degrades without creating suggestions when disconnected or unavailable", async () => {
    const disconnected = setup({ connected: false, result: null });
    await expect(
      disconnected.workflow.runCalendarSuggestionWorkflow({ ownerUserId: OWNER, now: NOW }),
    ).resolves.toEqual({ connected: false, generated: 0 });
    await expect(
      disconnected.store.listSuggestions({ ownerUserId: OWNER, status: "suggested" }),
    ).resolves.toEqual([]);

    const unavailable = setup({ connected: true, result: null });
    await expect(
      unavailable.workflow.runCalendarSuggestionWorkflow({ ownerUserId: OWNER, now: NOW }),
    ).resolves.toEqual({ connected: true, generated: 0 });
    await expect(
      unavailable.store.listSuggestions({ ownerUserId: OWNER, status: "suggested" }),
    ).resolves.toEqual([]);
  });
});
