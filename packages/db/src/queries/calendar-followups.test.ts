import type { CalendarAttendee, CalendarEventSummary } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryCalendarSuggestionStore } from "./calendar-followups/in-memory-store";
import { matchAttendee } from "./calendar-followups/matching";
import { generateCalendarSuggestionCandidates } from "./calendar-followups/pipeline";
import { createCalendarSuggestionReview } from "./calendar-followups/suggestions";
import type { CalendarPeopleMatcher } from "./calendar-followups/types";

const OWNER = "owner-1";
const NOW = new Date("2026-06-30T12:00:00.000Z");

function attendee(overrides: Partial<CalendarAttendee> = {}): CalendarAttendee {
  return {
    email: overrides.email ?? null,
    displayName: overrides.displayName ?? null,
    responseStatus: null,
    self: overrides.self ?? false,
    organizer: overrides.organizer ?? false,
  };
}

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: overrides.calendarId ?? "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-30T10:00:00.000Z"),
    // Ended an hour ago by default (a recent meeting).
    end: overrides.end ?? new Date("2026-06-30T11:00:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: overrides.status ?? "confirmed",
    attendees: overrides.attendees ?? [
      attendee({ email: "me@x.com", self: true }),
      attendee({ email: "maya@x.com", displayName: "Maya Chen" }),
    ],
    location: null,
    description: null,
    updatedAt: null,
  };
}

function matcher(overrides: Partial<CalendarPeopleMatcher> = {}): CalendarPeopleMatcher {
  return {
    findPeopleByEmail: overrides.findPeopleByEmail ?? (async () => []),
    findPeopleByName: overrides.findPeopleByName ?? (async () => []),
  };
}

describe("matchAttendee (ADR-0078)", () => {
  it("resolves a single email match confidently and never tentatively", async () => {
    const match = await matchAttendee(
      OWNER,
      attendee({ email: "maya@x.com", displayName: "Maya Chen" }),
      matcher({ findPeopleByEmail: async () => [{ id: "p1", displayName: "Maya Chen" }] }),
    );
    expect(match).toMatchObject({ personId: "p1", matchKind: "email", tentative: false });
  });

  it("treats a single display-name match as tentative", async () => {
    const match = await matchAttendee(
      OWNER,
      attendee({ displayName: "Maya Chen" }),
      matcher({ findPeopleByName: async () => [{ id: "p1", displayName: "Maya Chen" }] }),
    );
    expect(match).toMatchObject({ personId: "p1", matchKind: "display_name", tentative: true });
  });

  it("leaves ambiguous (multiple) matches unresolved rather than guessing", async () => {
    const match = await matchAttendee(
      OWNER,
      attendee({ email: "maya@x.com" }),
      matcher({
        findPeopleByEmail: async () => [
          { id: "p1", displayName: "Maya" },
          { id: "p2", displayName: "Maya R" },
        ],
      }),
    );
    expect(match).toMatchObject({ personId: null, matchKind: "unresolved" });
    expect(match.unresolvedAttendee).toBe("maya@x.com");
  });

  it("surfaces an unmatched attendee as link-needed context with no person link", async () => {
    const match = await matchAttendee(OWNER, attendee({ displayName: "Stranger" }), matcher());
    expect(match).toEqual({
      personId: null,
      personDisplayName: null,
      matchKind: "unresolved",
      tentative: false,
      unresolvedAttendee: "Stranger",
    });
  });
});

describe("generateCalendarSuggestionCandidates (deterministic-first, ADR-0082)", () => {
  it("only considers confirmed, recently-ended meetings with non-self attendees", async () => {
    const events = [
      event({ providerEventId: "ok" }),
      event({ providerEventId: "cancelled", status: "cancelled" }),
      event({ providerEventId: "future", end: new Date("2026-07-05T11:00:00.000Z") }),
      event({ providerEventId: "solo", attendees: [attendee({ email: "me@x.com", self: true })] }),
      event({
        providerEventId: "stale",
        end: new Date("2026-06-01T11:00:00.000Z"),
      }),
      event({ providerEventId: "allday", allDay: true }),
    ];
    const candidates = await generateCalendarSuggestionCandidates(
      { ownerUserId: OWNER, events, now: NOW },
      { matcher: matcher() },
    );
    expect(candidates.map((c) => c.providerEventId)).toEqual(["ok"]);
  });

  it("dedupes within a run and caps the number of candidates", async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event({
        providerEventId: `e${i}`,
        attendees: [attendee({ email: "me@x.com", self: true }), attendee({ email: "x@x.com" })],
      }),
    );
    const candidates = await generateCalendarSuggestionCandidates(
      { ownerUserId: OWNER, events, now: NOW },
      { matcher: matcher(), maxPerRun: 3 },
    );
    expect(candidates).toHaveLength(3);
  });

  it("uses an LLM reason over a bounded summary, falling back deterministically", async () => {
    const classify = vi.fn(async (input: { title: string; withWhom: string | null }) => {
      // The classifier sees only minimized fields — no raw payload.
      expect(Object.keys(input).sort()).toEqual(["startsAt", "title", "withWhom"]);
      return "Send Maya the deck you promised";
    });
    const [candidate] = await generateCalendarSuggestionCandidates(
      { ownerUserId: OWNER, events: [event()], now: NOW },
      {
        matcher: matcher({ findPeopleByEmail: async () => [{ id: "p1", displayName: "Maya" }] }),
        classify,
      },
    );
    expect(candidate?.reason).toBe("Send Maya the deck you promised");
    expect(classify).toHaveBeenCalledTimes(1);
  });
});

describe("Calendar suggestion review lifecycle (ADR-0077)", () => {
  function fakeFollowupCreate() {
    return vi.fn(async () => ({ id: "followup-1" }));
  }

  async function seededReview() {
    const store = createInMemoryCalendarSuggestionStore();
    const review = createCalendarSuggestionReview(store);
    const persisted = await review.generateSuggestions(
      { ownerUserId: OWNER, events: [event()], now: NOW },
      { matcher: matcher({ findPeopleByEmail: async () => [{ id: "p1", displayName: "Maya" }] }) },
    );
    return { store, review, suggestion: persisted[0] };
  }

  it("persists suggestions as `suggested` — never an active reminder", async () => {
    const { review, suggestion } = await seededReview();
    expect(suggestion?.status).toBe("suggested");
    await expect(review.listSuggestedFollowups(OWNER)).resolves.toHaveLength(1);
  });

  it("scopes suggestions to the owner", async () => {
    const { review } = await seededReview();
    await expect(review.listSuggestedFollowups("other-owner")).resolves.toEqual([]);
  });

  it("does not re-suggest a dismissed meeting (dedupe key blocks reintroduction)", async () => {
    const { review, suggestion } = await seededReview();
    await review.dismissSuggestedFollowup({ ownerUserId: OWNER, id: suggestion?.id ?? "" });

    const again = await review.generateSuggestions(
      { ownerUserId: OWNER, events: [event()], now: NOW },
      { matcher: matcher({ findPeopleByEmail: async () => [{ id: "p1", displayName: "Maya" }] }) },
    );
    expect(again).toEqual([]);
    await expect(review.listSuggestedFollowups(OWNER)).resolves.toEqual([]);
  });

  it("accept promotes into the active follow-up lifecycle and marks the suggestion accepted", async () => {
    const { review, suggestion } = await seededReview();
    const createActiveFollowup = fakeFollowupCreate();

    const accepted = await review.acceptSuggestedFollowup(
      { ownerUserId: OWNER, id: suggestion?.id ?? "" },
      { createActiveFollowup },
    );

    expect(createActiveFollowup).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER, personId: "p1" }),
    );
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedFollowupId).toBe("followup-1");
  });

  it("refuses to accept an unresolved suggestion (no durable person link)", async () => {
    const store = createInMemoryCalendarSuggestionStore();
    const review = createCalendarSuggestionReview(store);
    const [unresolved] = await review.generateSuggestions(
      {
        ownerUserId: OWNER,
        events: [
          event({
            attendees: [
              attendee({ email: "me@x.com", self: true }),
              attendee({ email: "ghost@x.com" }),
            ],
          }),
        ],
        now: NOW,
      },
      { matcher: matcher() },
    );

    await expect(
      review.acceptSuggestedFollowup(
        { ownerUserId: OWNER, id: unresolved?.id ?? "" },
        { createActiveFollowup: fakeFollowupCreate() },
      ),
    ).rejects.toThrow(/resolve the attendee/i);
  });
});
