import { describe, expect, it, vi } from "vitest";
import { createTodayCandidateLoaders } from "./candidate-loaders";

const OWNER = "owner-1";
const NOW = new Date("2026-07-21T15:00:00.000Z");

describe("Today cross-domain candidate loaders", () => {
  it("includes every supported family while excluding future, recent, cancelled, and restricted records", async () => {
    const loadRelationshipAgenda = vi.fn(async (input: { includeKinds?: string[] }) => {
      if (input.includeKinds?.includes("birthday")) {
        return [
          {
            kind: "birthday",
            personId: "person-birthday",
            personDisplayName: "Ari",
            title: "Ari has a birthday",
            reason: "Birthday falls inside the preparation window.",
            dueAt: new Date("2026-07-28T00:00:00.000Z"),
            sourceRefs: [{ kind: "person", id: "person-birthday" }],
            trustLevel: "stored_profile_data",
            sensitivity: "normal",
            rank: 1,
          },
        ];
      }
      return [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Sam",
          title: "Follow up with Sam",
          reason: "Stored Follow-Up is due.",
          dueAt: new Date("2026-07-20T09:00:00.000Z"),
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          rank: 1,
        },
        {
          kind: "review_item",
          personId: "person-1",
          personDisplayName: "Sam",
          title: "Review suggested memory for Sam",
          reason: "Suggested memory text",
          sourceRefs: [{ kind: "memory", id: "memory-review" }],
          trustLevel: "tentative",
          sensitivity: "normal",
          rank: 2,
        },
        {
          kind: "recent_context",
          personId: "person-1",
          personDisplayName: "Sam",
          title: "Old grounded context",
          reason: "A source-grounded relationship detail.",
          dueAt: new Date("2026-05-01T00:00:00.000Z"),
          sourceRefs: [{ kind: "source_record", id: "old-context" }],
          trustLevel: "logged_context",
          sensitivity: "normal",
          rank: 3,
        },
        {
          kind: "recent_context",
          personId: "person-1",
          personDisplayName: "Sam",
          title: "Restricted context",
          reason: "Never proactive.",
          dueAt: new Date("2026-05-01T00:00:00.000Z"),
          sourceRefs: [{ kind: "source_record", id: "restricted-context" }],
          trustLevel: "logged_context",
          sensitivity: "restricted",
          rank: 4,
        },
      ];
    });
    const loaders = createTodayCandidateLoaders({
      loadRelationshipAgenda: loadRelationshipAgenda as never,
      listActions: vi.fn(async () => [
        {
          id: "action-due",
          ownerUserId: OWNER,
          scope: "private",
          ownership: "member_owned",
          responsibilityHolderUserId: null,
          title: "Replace the filter",
          status: "open",
          dueAt: new Date("2026-07-21T00:00:00.000Z"),
          deferUntil: null,
          recurrence: null,
          sourceRecordId: null,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: NOW,
        },
        {
          id: "routine-due",
          ownerUserId: OWNER,
          scope: "private",
          ownership: "member_owned",
          responsibilityHolderUserId: null,
          title: "Water plants",
          status: "open",
          dueAt: new Date("2026-07-21T00:00:00.000Z"),
          deferUntil: null,
          recurrence: { interval: 1, unit: "week" },
          sourceRecordId: null,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: NOW,
        },
        {
          id: "action-future",
          ownerUserId: OWNER,
          scope: "private",
          ownership: "member_owned",
          responsibilityHolderUserId: null,
          title: "Future action",
          status: "open",
          dueAt: new Date("2026-07-23T00:00:00.000Z"),
          deferUntil: null,
          recurrence: null,
          sourceRecordId: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]) as never,
      listSavedItems: vi.fn(async () => [
        {
          id: "saved-arrived",
          ownerUserId: OWNER,
          kind: "note",
          title: "Filter measurements",
          content: "20 by 25",
          url: null,
          status: "active",
          bringBackAt: new Date("2026-07-21T09:00:00.000Z"),
          sourceRecordId: "source-saved",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: NOW,
        },
        {
          id: "saved-too-new",
          ownerUserId: OWNER,
          kind: "note",
          title: "Fresh note",
          content: null,
          url: null,
          status: "active",
          bringBackAt: null,
          sourceRecordId: "source-new",
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
          updatedAt: NOW,
        },
      ]) as never,
      getSourceRecord: vi.fn(async () => ({ sensitivity: "normal" })) as never,
      readCalendar: vi.fn(async () => ({
        connected: true,
        result: {
          events: [
            {
              providerEventId: "calendar-recent-with-person",
              calendarId: "primary",
              title: "Lunch with Morgan",
              start: new Date("2026-07-20T18:00:00.000Z"),
              end: new Date("2026-07-20T19:00:00.000Z"),
              allDay: false,
              status: "confirmed",
              attendees: [
                {
                  email: "morgan@example.com",
                  displayName: "Morgan",
                  responseStatus: "accepted",
                  self: false,
                  organizer: false,
                },
              ],
              location: null,
              description: null,
              updatedAt: NOW,
            },
            {
              providerEventId: "calendar-recent-solo",
              calendarId: "primary",
              title: "Focus time",
              start: new Date("2026-07-20T16:00:00.000Z"),
              end: new Date("2026-07-20T17:00:00.000Z"),
              allDay: false,
              status: "confirmed",
              attendees: [],
              location: null,
              description: null,
              updatedAt: NOW,
            },
            {
              providerEventId: "calendar-live",
              calendarId: "primary",
              title: "Dentist",
              start: new Date("2026-07-21T18:00:00.000Z"),
              end: new Date("2026-07-21T19:00:00.000Z"),
              allDay: false,
              status: "confirmed",
              attendees: [],
              location: null,
              description: null,
              updatedAt: NOW,
            },
            {
              providerEventId: "calendar-cancelled",
              calendarId: "primary",
              title: "Cancelled",
              start: new Date("2026-07-21T20:00:00.000Z"),
              end: new Date("2026-07-21T21:00:00.000Z"),
              allDay: false,
              status: "cancelled",
              attendees: [],
              location: null,
              description: null,
              updatedAt: NOW,
            },
          ],
          source: "live",
          stale: false,
          fetchedAt: NOW,
          expiresAt: new Date("2026-07-21T15:05:00.000Z"),
        },
      })) as never,
      listAdditionalReviews: vi.fn(async () => [
        {
          id: "asset-review",
          title: "Review refrigerator details",
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
          href: "/?tab=review",
          sourceRefs: [{ kind: "asset_review_group", id: "asset-review" }],
          sensitivity: "normal",
        },
      ]) as never,
    });

    const groups = await Promise.all(
      loaders.map((load) =>
        load({
          ownerUserId: OWNER,
          localDate: "2026-07-21",
          timeZone: "America/Chicago",
          now: NOW,
        }),
      ),
    );
    const candidates = groups.flat();

    expect(new Set(candidates.map((item) => item.family))).toEqual(
      new Set([
        "follow_up",
        "birthday",
        "action",
        "routine",
        "calendar",
        "review",
        "saved_item",
        "relationship_context",
      ]),
    );
    expect(candidates.map((item) => item.record.id)).not.toEqual(
      expect.arrayContaining([
        "action-future",
        "saved-too-new",
        "calendar-cancelled",
        "restricted-context",
        "primary:calendar-recent-solo",
      ]),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        identity: "recent_calendar:primary:calendar-recent-with-person",
        mandatory: false,
        reason: expect.objectContaining({ code: "relationship_resurfacing" }),
      }),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        identity: "action:action-due",
        reason: expect.objectContaining({ code: "due_today", explanation: "Due today." }),
      }),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        identity: "birthday:person-birthday",
        reason: expect.objectContaining({ explanation: "Birthday on Jul 28." }),
      }),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        identity: "calendar:primary:calendar-live",
        reason: expect.objectContaining({ explanation: "Calendar event at 1:00 PM." }),
      }),
    );
  });
});
