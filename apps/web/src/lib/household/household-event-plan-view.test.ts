import type { CalendarEventSummary } from "@tendnote/domain";
import type { HouseholdCalendarRead } from "@tendnote/domain/household-calendar";
import type { HouseholdEventPlan } from "@tendnote/domain/household-event-plans";
import { describe, expect, it } from "vitest";
import { householdEventPlanFixture } from "@/test/household-event-plan-fixtures";
import {
  buildHouseholdEventPlanConflictView,
  buildHouseholdEventPlanLinkChoices,
  buildHouseholdEventPlanViews,
  HOUSEHOLD_EVENT_PLAN_DEPARTED_ACTOR,
  type HouseholdEventPlanRecord,
  householdActorName,
  plannedHouseholdCalendarEventKeys,
  resolveHouseholdEventPlanCalendarReference,
} from "./household-event-plan-view";

const NAMES = new Map([
  ["ana", "Ana"],
  ["ben", "Ben"],
]);

/** A Plan as the read layer hands it over, with whatever links survived the proof. */
function record(
  plan: HouseholdEventPlan,
  links: HouseholdEventPlanRecord["links"] = [],
): HouseholdEventPlanRecord {
  return { plan, links };
}

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: "event-1",
    calendarId: "primary",
    title: "School concert",
    start: new Date("2026-08-11T18:30:00Z"),
    end: new Date("2026-08-11T20:00:00Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
    ...overrides,
  };
}

function readWith(events: CalendarEventSummary[], stale = false): HouseholdCalendarRead {
  return {
    families: [
      {
        connectionId: "connection-1",
        label: "Family calendar",
        state: "events",
        stale,
        fetchedAt: new Date("2026-08-09T09:00:00Z"),
        events,
      },
    ],
  };
}

const REFERRING = {
  calendarConnectionId: "connection-1",
  calendarId: "primary",
  calendarProviderEventId: "event-1",
};

describe("householdActorName", () => {
  it("names the reader as themselves and everyone else by name", () => {
    expect(householdActorName({ userId: "ana", viewerUserId: "ana", memberNames: NAMES })).toBe(
      "you",
    );
    expect(householdActorName({ userId: "ben", viewerUserId: "ana", memberNames: NAMES })).toBe(
      "Ben",
    );
  });

  /**
   * Attribution survives a departure, so there is still an actor to name and no
   * name left to print. Saying so plainly beats inventing one or showing an id.
   */
  it("keeps the attribution of someone who is no longer here", () => {
    expect(householdActorName({ userId: "gone", viewerUserId: "ana", memberNames: NAMES })).toBe(
      HOUSEHOLD_EVENT_PLAN_DEPARTED_ACTOR,
    );
  });
});

describe("resolveHouseholdEventPlanCalendarReference", () => {
  it("says a plan refers to nothing when it never did", () => {
    expect(
      resolveHouseholdEventPlanCalendarReference(householdEventPlanFixture(), readWith([event()])),
    ).toEqual({
      state: "none",
    });
  });

  it("resolves a live reference and carries its calendar's freshness", () => {
    expect(
      resolveHouseholdEventPlanCalendarReference(
        householdEventPlanFixture(REFERRING),
        readWith([event()], true),
      ),
    ).toEqual({
      state: "event",
      connectionId: "connection-1",
      label: "Family calendar",
      title: "School concert",
      start: new Date("2026-08-11T18:30:00Z"),
      allDay: false,
      stale: true,
    });
  });

  /**
   * Disconnected, unreadable, deleted, or simply outside the window that was
   * read: one honest answer for all of them, and the Plan keeps its own content
   * in every case rather than falling back to cached provider content.
   */
  it("says the calendar is unavailable for every way a reference fails to resolve", () => {
    expect(
      resolveHouseholdEventPlanCalendarReference(householdEventPlanFixture(REFERRING), null),
    ).toEqual({
      state: "unavailable",
    });
    expect(
      resolveHouseholdEventPlanCalendarReference(householdEventPlanFixture(REFERRING), {
        families: [
          { connectionId: "connection-1", label: "Family calendar", state: "unavailable" },
        ],
      }),
    ).toEqual({ state: "unavailable" });
    expect(
      resolveHouseholdEventPlanCalendarReference(
        householdEventPlanFixture(REFERRING),
        readWith([event({ providerEventId: "event-9" })]),
      ),
    ).toEqual({ state: "unavailable" });
  });
});

describe("buildHouseholdEventPlanViews", () => {
  it("reads a plan's provenance as three facts and no more", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [
        record(
          householdEventPlanFixture({
            lastActorUserId: "ben",
            version: 3,
            updatedAt: new Date("2026-08-09T18:30:00Z"),
          }),
        ),
      ],
      read: null,
      viewerUserId: "ana",
    });

    expect(active[0]?.provenance).toEqual({
      startedBy: "you",
      changedBy: "Ben",
      atLabel: "Aug 9, 6:30 PM",
    });
  });

  /** An untouched plan has no "changed by" to report, so it reports none. */
  it("says only who started a plan nobody has changed", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [record(householdEventPlanFixture())],
      read: null,
      viewerUserId: "ben",
    });

    expect(active[0]?.provenance).toEqual({
      startedBy: "Ana",
      changedBy: null,
      atLabel: "Aug 1, 9:00 AM",
    });
  });

  it("round-trips the household's own date for both reading and editing", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [record(householdEventPlanFixture({ plannedFor: new Date("2026-08-15T00:00:00Z") }))],
      read: null,
      viewerUserId: "ana",
    });

    expect(active[0]?.plannedForLabel).toBe("Sat, Aug 15, 2026");
    expect(active[0]?.plannedForInput).toBe("2026-08-15");
  });

  /**
   * A write replaces a Plan's whole value, so an edit form has to be able to
   * restate the address even when today's read cannot resolve it.
   */
  it("keeps the stored address beside a reference that cannot resolve", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [record(householdEventPlanFixture(REFERRING))],
      read: null,
      viewerUserId: "ana",
    });

    expect(active[0]?.calendar).toEqual({ state: "unavailable" });
    expect(active[0]?.calendarAddress).toEqual({
      connectionId: "connection-1",
      calendarId: "primary",
      providerEventId: "event-1",
    });
  });

  it("leads with what is coming up, then the undated, then what was put away", () => {
    const { active, archived } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [
        record(
          householdEventPlanFixture({
            id: "undated-old",
            title: "Older idea",
            createdAt: new Date("2026-07-01T09:00:00Z"),
          }),
        ),
        record(
          householdEventPlanFixture({
            id: "later",
            title: "Later",
            plannedFor: new Date("2026-09-01T00:00:00Z"),
          }),
        ),
        record(
          householdEventPlanFixture({
            id: "gone",
            title: "Last year's concert",
            status: "archived",
            updatedAt: new Date("2026-08-05T09:00:00Z"),
          }),
        ),
        record(
          householdEventPlanFixture({
            id: "undated-new",
            title: "Newer idea",
            createdAt: new Date("2026-08-08T09:00:00Z"),
          }),
        ),
        record(
          householdEventPlanFixture({
            id: "soon",
            title: "Soon",
            plannedFor: new Date("2026-08-12T00:00:00Z"),
          }),
        ),
      ],
      read: null,
      viewerUserId: "ana",
    });

    expect(active.map((view) => view.title)).toEqual(["Soon", "Later", "Newer idea", "Older idea"]);
    expect(archived.map((view) => view.title)).toEqual(["Last year's concert"]);
  });
});

describe("a plan's links", () => {
  /** A link reads as the record it points at. The surface never gets an id to show. */
  it("names each link by its record and by what family it belongs to", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [
        record(householdEventPlanFixture(), [
          {
            id: "link-1",
            linkKind: "general_action",
            recordId: "action-1",
            title: "Bring the folding chairs",
          },
          { id: "link-2", linkKind: "followup", recordId: "followup-1", title: "Ask about Mara" },
          { id: "link-3", linkKind: "saved_item", recordId: "saved-1", title: "The good recipe" },
        ]),
      ],
      read: null,
      viewerUserId: "ana",
    });

    expect(active[0]?.links).toEqual([
      {
        id: "link-1",
        kind: "general_action",
        kindLabel: "Action",
        recordId: "action-1",
        title: "Bring the folding chairs",
      },
      {
        id: "link-2",
        kind: "followup",
        kindLabel: "Follow-up",
        recordId: "followup-1",
        title: "Ask about Mara",
      },
      {
        id: "link-3",
        kind: "saved_item",
        kindLabel: "Saved item",
        recordId: "saved-1",
        title: "The good recipe",
      },
    ]);
  });

  /** A reader whose links were all refused sees a plan with no links, not a gap. */
  it("carries an empty list when the proof left nothing behind", () => {
    const { active } = buildHouseholdEventPlanViews({
      memberNames: NAMES,
      plans: [record(householdEventPlanFixture())],
      read: null,
      viewerUserId: "ana",
    });

    expect(active[0]?.links).toEqual([]);
  });
});

describe("buildHouseholdEventPlanLinkChoices", () => {
  const CANDIDATES = [
    { kind: "general_action" as const, id: "action-1", title: "Bring the folding chairs" },
    { kind: "saved_item" as const, id: "saved-1", title: "The good recipe" },
    { kind: "followup" as const, id: "followup-1", title: "Ask about Mara" },
    { kind: "general_action" as const, id: "action-2", title: "Book the hall" },
  ];

  it("groups what is left in one fixed order, whatever order the records arrived in", () => {
    expect(
      buildHouseholdEventPlanLinkChoices({ candidates: CANDIDATES, links: [] }).map((group) => [
        group.label,
        group.candidates.map((candidate) => candidate.title),
      ]),
    ).toEqual([
      ["Action", ["Bring the folding chairs", "Book the hall"]],
      ["Follow-up", ["Ask about Mara"]],
      ["Saved item", ["The good recipe"]],
    ]);
  });

  /**
   * A record this Plan already links is not a choice, so it is gone rather than
   * shown disabled - and a family with nothing left loses its heading with it.
   */
  it("leaves out what the plan already links, and drops a family it empties", () => {
    const groups = buildHouseholdEventPlanLinkChoices({
      candidates: CANDIDATES,
      links: [
        {
          id: "link-1",
          kind: "general_action",
          kindLabel: "Action",
          recordId: "action-1",
          title: "Bring the folding chairs",
        },
        {
          id: "link-2",
          kind: "followup",
          kindLabel: "Follow-up",
          recordId: "followup-1",
          title: "Ask about Mara",
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual(["Action", "Saved item"]);
    expect(groups[0]?.candidates.map((candidate) => candidate.id)).toEqual(["action-2"]);
  });

  /**
   * Ids are only unique within a family, so the exclusion is keyed on both. A
   * Saved Item is not hidden because an Action happens to share its id.
   */
  it("excludes a record from its own family only", () => {
    const groups = buildHouseholdEventPlanLinkChoices({
      candidates: [
        { kind: "general_action", id: "shared-id", title: "Book the hall" },
        { kind: "saved_item", id: "shared-id", title: "The good recipe" },
      ],
      links: [
        {
          id: "link-1",
          kind: "general_action",
          kindLabel: "Action",
          recordId: "shared-id",
          title: "Book the hall",
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual(["Saved item"]);
  });

  it("has nothing to offer when the member keeps nothing linkable", () => {
    expect(buildHouseholdEventPlanLinkChoices({ candidates: [], links: [] })).toEqual([]);
  });
});

describe("plannedHouseholdCalendarEventKeys", () => {
  /**
   * Archived plans are left out so a household that put last year's event away
   * can plan this year's without the calendar row claiming it is handled.
   */
  it("counts only the events an active plan still refers to", () => {
    const keys = plannedHouseholdCalendarEventKeys([
      householdEventPlanFixture(REFERRING),
      householdEventPlanFixture({
        ...REFERRING,
        id: "plan-2",
        calendarProviderEventId: "event-2",
        status: "archived",
      }),
      householdEventPlanFixture({ id: "plan-3" }),
    ]);

    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain("event-1");
  });
});

describe("buildHouseholdEventPlanConflictView", () => {
  it("states the value that won, who wrote it, and the version to write against", () => {
    expect(
      buildHouseholdEventPlanConflictView({
        current: householdEventPlanFixture({
          title: "Supper at Ana's",
          details: "Bring the good plates",
          plannedFor: new Date("2026-08-15T00:00:00Z"),
          lastActorUserId: "ben",
          version: 4,
          updatedAt: new Date("2026-08-09T18:30:00Z"),
        }),
        memberNames: NAMES,
        viewerUserId: "ana",
      }),
    ).toEqual({
      title: "Supper at Ana's",
      details: "Bring the good plates",
      plannedForLabel: "Sat, Aug 15, 2026",
      changedBy: "Ben",
      atLabel: "Aug 9, 6:30 PM",
      version: 4,
    });
  });
});
