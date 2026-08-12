import { describe, expect, it } from "vitest";
import {
  assertHouseholdEventPlanEditable,
  assertHouseholdEventPlanVersion,
  HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT,
  HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT,
  type HouseholdEventPlan,
  HouseholdEventPlanConflictError,
  householdEventPlanCalendarRef,
  householdEventPlanSchema,
  normalizeHouseholdEventPlanDraft,
} from "./household-event-plans";
import { HouseholdValidationError } from "./household-policy";

function plan(overrides: Partial<HouseholdEventPlan> = {}): HouseholdEventPlan {
  return {
    id: "plan-1",
    householdId: "household-1",
    createdByUserId: "ana",
    lastActorUserId: "ana",
    title: "School concert night",
    details: null,
    plannedFor: null,
    status: "active",
    archivedAt: null,
    calendarConnectionId: null,
    calendarId: null,
    calendarProviderEventId: null,
    version: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("draft normalization", () => {
  it("retains a plan after its creator and last actor accounts are gone", () => {
    expect(
      householdEventPlanSchema.parse(plan({ createdByUserId: null, lastActorUserId: null })),
    ).toMatchObject({ createdByUserId: null, lastActorUserId: null });
  });

  it("trims the title and keeps empty notes as null rather than an empty string", () => {
    expect(normalizeHouseholdEventPlanDraft({ title: "  Concert  ", details: "   " })).toEqual({
      title: "Concert",
      details: null,
      plannedFor: null,
      calendarEvent: null,
    });
  });

  it("refuses a blank name with a sentence a member can act on", () => {
    expect(() => normalizeHouseholdEventPlanDraft({ title: "   " })).toThrow(
      HouseholdValidationError,
    );
    expect(() => normalizeHouseholdEventPlanDraft({ title: "   " })).toThrow(/short name/i);
  });

  it("refuses over-long text rather than silently truncating someone's note", () => {
    expect(() =>
      normalizeHouseholdEventPlanDraft({ title: "x".repeat(HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT + 1) }),
    ).toThrow(HouseholdValidationError);
    expect(() =>
      normalizeHouseholdEventPlanDraft({
        title: "Concert",
        details: "x".repeat(HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT + 1),
      }),
    ).toThrow(/notes/i);
  });

  it("keeps a calendar reference as an address, carrying no event content", () => {
    const normalized = normalizeHouseholdEventPlanDraft({
      title: "Concert",
      calendarEvent: {
        connectionId: "connection-1",
        calendarId: "primary",
        providerEventId: "event-1",
      },
    });
    expect(normalized.calendarEvent).toEqual({
      connectionId: "connection-1",
      calendarId: "primary",
      providerEventId: "event-1",
    });
    expect(Object.keys(normalized)).toEqual(["title", "details", "plannedFor", "calendarEvent"]);
  });

  it("allows a plan with no calendar reference at all", () => {
    expect(normalizeHouseholdEventPlanDraft({ title: "Concert" }).calendarEvent).toBeNull();
  });
});

describe("lifecycle", () => {
  it("lets an active plan be edited", () => {
    expect(() => assertHouseholdEventPlanEditable(plan())).not.toThrow();
  });

  it("makes an archived plan read-only until it is brought back", () => {
    expect(() => assertHouseholdEventPlanEditable(plan({ status: "archived" }))).toThrow(
      HouseholdValidationError,
    );
  });
});

describe("optimistic concurrency", () => {
  it("accepts a write fenced on the version the member was looking at", () => {
    expect(() => assertHouseholdEventPlanVersion(plan({ version: 3 }), 3)).not.toThrow();
  });

  it("refuses a stale write and hands back the current value and its actor", () => {
    const current = plan({ version: 4, lastActorUserId: "ben", title: "Concert, moved" });
    try {
      assertHouseholdEventPlanVersion(current, 3);
      expect.unreachable("expected a conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(HouseholdEventPlanConflictError);
      const conflict = error as HouseholdEventPlanConflictError;
      expect(conflict.current.title).toBe("Concert, moved");
      expect(conflict.current.lastActorUserId).toBe("ben");
      expect(conflict.message).toMatch(/draft is kept/i);
    }
  });
});

describe("calendar reference", () => {
  it("resolves an address only when all three parts are present", () => {
    expect(
      householdEventPlanCalendarRef(
        plan({
          calendarConnectionId: "connection-1",
          calendarId: "primary",
          calendarProviderEventId: "event-1",
        }),
      ),
    ).toEqual({ connectionId: "connection-1", calendarId: "primary", providerEventId: "event-1" });
  });

  it("resolves to null when the reference is absent or partial", () => {
    expect(householdEventPlanCalendarRef(plan())).toBeNull();
    expect(
      householdEventPlanCalendarRef(plan({ calendarConnectionId: "connection-1" })),
    ).toBeNull();
  });

  it("stores no provider content beside the address", () => {
    const stored = plan({
      calendarConnectionId: "connection-1",
      calendarId: "primary",
      calendarProviderEventId: "event-1",
    });
    for (const field of ["eventTitle", "eventStart", "attendees", "responseStatus"]) {
      expect(stored).not.toHaveProperty(field);
    }
  });
});
