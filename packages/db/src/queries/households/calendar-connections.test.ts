import { randomUUID } from "node:crypto";
import {
  type CalendarEventSummary,
  findHouseholdCalendarEvent,
  HOUSEHOLD_CALENDAR_CAPABILITY,
  HOUSEHOLD_CALENDAR_CONNECTION_LIMIT,
  HOUSEHOLD_CALENDAR_PROVIDER,
  HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE,
  type HouseholdCalendarConnectionSummary,
  type HouseholdCalendarRead,
  HouseholdRecordUnavailableError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createFailingCalendarAdapter, createFakeCalendarAdapter } from "../calendar/fake-adapter";
import { createInMemoryCalendarCacheStore } from "../calendar/in-memory-store";
import { createCalendarReader } from "../calendar/reader";
import type { CalendarProviderAdapter } from "../calendar/types";
import { createHouseholdAuthorizationProver } from "./authorization";
import { createHouseholdCalendarLifecycle } from "./calendar-connections";
import { createHouseholdEventPlanLifecycle } from "./event-plans";
import { createHouseholdGovernanceLifecycle } from "./governance";
import { removeHouseholdMember, seedHouseholdWithMembers } from "./household-fixtures";
import {
  createInMemoryHouseholdEventPlanLinkTargetStore,
  createInMemoryHouseholdEventPlanStore,
} from "./in-memory-event-plan-store";
import { createInMemoryHouseholdInvitationStore } from "./in-memory-invitation-store";

/**
 * `ANA` and `BEN` govern and each hold a Google grant of their own. `CAI` is a
 * plain member who has never connected Google - the person ADR 0217 is really
 * about, since an authorized Household Calendar has to read for them exactly as
 * well as for the connector. `DEE` was never here at all.
 */
const ANA = "user-ana";
const BEN = "user-ben";
const CAI = "user-cai";
const DEE = "user-dee";

const NOW = new Date("2026-08-08T12:00:00Z");
const WINDOW = {
  timeMin: new Date("2026-08-08T00:00:00Z"),
  timeMax: new Date("2026-08-15T00:00:00Z"),
};
const MINUTE = 60 * 1000;

const FAMILY_CALENDAR = "family@group.calendar.google.com";
const SCHOOL_CALENDAR = "school@group.calendar.google.com";

function event(calendarId: string, providerEventId: string, title: string): CalendarEventSummary {
  return {
    providerEventId,
    calendarId,
    title,
    start: new Date("2026-08-10T17:00:00Z"),
    end: new Date("2026-08-10T18:00:00Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
  };
}

type Fixture = ReturnType<typeof createFixture>;

/**
 * One household store shared by the calendar, governance, and Event Plan
 * lifecycles, so a departure asserted here is asserted against the very rows the
 * calendar read consults.
 *
 * `adapters` is keyed by calendar id and looked up per read, which is what lets a
 * test swap a working provider for a failing one mid-suite; `connectedConnectors`
 * stands in for the connector's own Provider Connection. No network, no Google,
 * no token: `readerFor` is the seam that keeps this whole file offline.
 */
function createFixture() {
  const eventPlanStore = createInMemoryHouseholdEventPlanStore();
  const store = createInMemoryHouseholdInvitationStore();
  const clock = { ms: NOW.getTime() };
  const adapters = new Map<string, CalendarProviderAdapter>();
  const connectedConnectors = new Set<string>([ANA, BEN]);

  return {
    store,
    clock,
    adapters,
    connectedConnectors,
    calendars: createHouseholdCalendarLifecycle({
      households: store.households,
      calendars: store.calendars,
      readerFor: (connection) =>
        createCalendarReader({
          adapter: {
            listEvents: (input) => {
              const adapter = adapters.get(connection.calendarId);
              if (!adapter) throw new Error(`No fake adapter for ${connection.calendarId}`);
              return adapter.listEvents(input);
            },
          },
          cacheStore: store.calendars.cacheStoreFor({ connectionId: connection.id }),
          now: () => clock.ms,
        }),
      isConnectorConnected: async ({ ownerUserId }) => connectedConnectors.has(ownerUserId),
      now: () => NOW,
    }),
    eventPlanStore,
    governance: createHouseholdGovernanceLifecycle(store, { now: () => NOW }),
    plans: createHouseholdEventPlanLifecycle({
      households: store.households,
      plans: eventPlanStore,
      linkTargets: createInMemoryHouseholdEventPlanLinkTargetStore(),
      prover: createHouseholdAuthorizationProver(store.households),
      now: () => NOW,
    }),
  };
}

/** One household holding the named people, `ANA` owning it. */
async function seed(
  fixture: Fixture,
  members: ReadonlyArray<readonly [string, "owner" | "member"]>,
) {
  return seedHouseholdWithMembers(fixture.store.households, { ownerUserId: ANA, members });
}

/** Designates one calendar and registers the fake provider behind it. */
async function designate(
  fixture: Fixture,
  input: {
    ownerUserId?: string;
    calendarId: string;
    label: string;
    events?: CalendarEventSummary[];
    adapter?: CalendarProviderAdapter;
  },
): Promise<HouseholdCalendarConnectionSummary> {
  fixture.adapters.set(
    input.calendarId,
    input.adapter ??
      createFakeCalendarAdapter(input.events ?? [event(input.calendarId, "evt-1", "Dinner")]),
  );
  return fixture.calendars.connectHouseholdCalendar({
    ownerUserId: input.ownerUserId ?? ANA,
    calendarId: input.calendarId,
    label: input.label,
    connectorHasCalendarAccess: true,
  });
}

function read(fixture: Fixture, callerUserId: string) {
  return fixture.calendars.readHouseholdCalendars({ callerUserId, ...WINDOW });
}

/** The named family, narrowed to the readable case so a test can assert its events. */
function readableFamily(result: HouseholdCalendarRead, connectionId: string) {
  const family = result.families.find((candidate) => candidate.connectionId === connectionId);
  if (family?.state !== "events") {
    throw new Error(`Expected a readable family for ${connectionId}, got ${family?.state}`);
  }
  return family;
}

function familyOf(result: HouseholdCalendarRead, connectionId: string) {
  return result.families.find((candidate) => candidate.connectionId === connectionId);
}

function titlesFor(result: HouseholdCalendarRead, connectionId: string) {
  return readableFamily(result, connectionId).events.map((summary) => summary.title);
}

async function auditActions(fixture: Fixture, actorUserId: string) {
  const entries = await fixture.store.households.listAuditLogEntries({ ownerUserId: actorUserId });
  return entries.map((entry) => entry.action);
}

/** An Event Plan pointing at one designated calendar event, created by `CAI`. */
async function planForEvent(fixture: Fixture, connectionId: string) {
  const plan = await fixture.plans.createHouseholdEventPlan({
    callerUserId: CAI,
    draft: {
      title: "Saturday school fair",
      calendarEvent: {
        connectionId,
        calendarId: FAMILY_CALENDAR,
        providerEventId: "evt-1",
      },
    },
  });
  // Pinned here so the "reference emptied" assertions below cannot pass against
  // a Plan that never had one.
  expect(plan).toMatchObject({
    calendarConnectionId: connectionId,
    calendarId: FAMILY_CALENDAR,
    calendarProviderEventId: "evt-1",
  });
  return plan;
}

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});

describe("designating a household calendar", () => {
  it("lets an owner share one calendar with everyone who lives here", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);

    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });

    expect(connection).toMatchObject({
      label: "Family",
      calendarId: FAMILY_CALENDAR,
      // The connector is the caller and the designator is the caller: only the
      // person whose calendar it is can say it suits the household.
      connectorUserId: ANA,
      designatedByUserId: ANA,
      connectedAt: NOW,
    });
    expect(
      await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: CAI }),
    ).toMatchObject([{ id: connection.id, label: "Family" }]);
    expect(await auditActions(fixture, ANA)).toContain("household.calendar.connect");
  });

  it("refuses a plain member, because sharing changes what everyone can read", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);

    await expect(
      designate(fixture, { ownerUserId: CAI, calendarId: FAMILY_CALENDAR, label: "Mine" }),
    ).rejects.toThrow(/only a household owner can share a calendar/i);
    expect(await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: ANA })).toEqual(
      [],
    );
  });

  it("refuses an owner who has already been removed, in words that name nothing", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
    ]);
    await removeHouseholdMember(fixture.store.households, {
      householdId: household.id,
      userId: BEN,
    });

    await expect(
      designate(fixture, { ownerUserId: BEN, calendarId: FAMILY_CALENDAR, label: "Family" }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });

  it("refuses an owner who has no Google Calendar of their own to share", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    fixture.adapters.set(FAMILY_CALENDAR, createFakeCalendarAdapter([]));

    await expect(
      fixture.calendars.connectHouseholdCalendar({
        ownerUserId: ANA,
        calendarId: FAMILY_CALENDAR,
        label: "Family",
        connectorHasCalendarAccess: false,
      }),
    ).rejects.toThrow(/connect your own google calendar first/i);
  });

  it("refuses the same calendar a second time", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    await designate(fixture, { calendarId: FAMILY_CALENDAR, label: "Family" });

    await expect(
      designate(fixture, { calendarId: FAMILY_CALENDAR, label: "Family again" }),
    ).rejects.toThrow(/already shared with this household/i);
    expect(
      await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: ANA }),
    ).toHaveLength(1);
  });

  it("holds the household to its connection limit", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    for (let index = 0; index < HOUSEHOLD_CALENDAR_CONNECTION_LIMIT; index += 1) {
      await designate(fixture, {
        calendarId: `cal-${index}@group.calendar.google.com`,
        label: `Calendar ${index}`,
      });
    }

    await expect(
      designate(fixture, { calendarId: SCHOOL_CALENDAR, label: "One too many" }),
    ).rejects.toThrow(`up to ${HOUSEHOLD_CALENDAR_CONNECTION_LIMIT} calendars`);
    expect(
      await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: ANA }),
    ).toHaveLength(HOUSEHOLD_CALENDAR_CONNECTION_LIMIT);
  });
});

describe("reading a designated calendar", () => {
  /** ADR 0217's core promise, asserted for each member in turn. */
  it("reads for every active member, connector or not, Google account or not", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
      events: [
        event(FAMILY_CALENDAR, "evt-1", "School fair"),
        event(FAMILY_CALENDAR, "evt-2", "Swimming"),
      ],
    });

    for (const callerUserId of [ANA, BEN, CAI]) {
      const result = await read(fixture, callerUserId);
      expect(result.families).toHaveLength(1);
      expect(titlesFor(result, connection.id)).toEqual(["School fair", "Swimming"]);
    }
    // CAI never had a Google grant to begin with, and BEN is not the connector:
    // the read rides ANA's grant for both of them.
    expect(fixture.connectedConnectors.has(CAI)).toBe(false);
  });

  it("gives a non-member and a removed member the outcome of no such household", async () => {
    const household = await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    expect(readableFamily(await read(fixture, CAI), connection.id).events).toHaveLength(1);

    await removeHouseholdMember(fixture.store.households, {
      householdId: household.id,
      userId: CAI,
    });

    // No content, no count, and the same sentence for "you were removed" as for
    // "there is no household here at all" (ADR 0219).
    for (const callerUserId of [CAI, DEE]) {
      await expect(read(fixture, callerUserId)).rejects.toThrow(
        HOUSEHOLD_RECORD_UNAVAILABLE_MESSAGE,
      );
      await expect(
        fixture.calendars.listHouseholdCalendarConnections({ callerUserId }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    }
  });

  it("keeps a readable calendar readable when another one fails", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const family = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
      events: [event(FAMILY_CALENDAR, "evt-1", "School fair")],
    });
    const school = await designate(fixture, {
      calendarId: SCHOOL_CALENDAR,
      label: "School",
      adapter: createFailingCalendarAdapter(),
    });

    const result = await read(fixture, CAI);

    expect(result.families).toHaveLength(2);
    expect(titlesFor(result, family.id)).toEqual(["School fair"]);
    expect(familyOf(result, school.id)).toEqual({
      connectionId: school.id,
      label: "School",
      state: "unavailable",
    });
    // The working family is untouched by its neighbour's failure, including its
    // cache: a broken calendar leaves no mark on a good one.
    expect(fixture.store.calendars.cachedEntries({ connectionId: family.id })).toHaveLength(1);
    expect(fixture.store.calendars.cachedEntries({ connectionId: school.id })).toEqual([]);
  });

  it("marks a within-horizon cache stale, and says nothing of the sort while it is fresh", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
      events: [event(FAMILY_CALENDAR, "evt-1", "School fair")],
    });

    const live = readableFamily(await read(fixture, CAI), connection.id);
    expect(live).toMatchObject({ stale: false, fetchedAt: NOW });

    // Still inside the freshness window: served from cache, and still not stale.
    fixture.clock.ms = NOW.getTime() + MINUTE;
    expect(readableFamily(await read(fixture, CAI), connection.id).stale).toBe(false);

    // Expired, but inside the stale-fallback horizon, and the provider is down.
    fixture.clock.ms = NOW.getTime() + 10 * MINUTE;
    fixture.adapters.set(FAMILY_CALENDAR, createFailingCalendarAdapter());
    const stale = readableFamily(await read(fixture, CAI), connection.id);
    expect(stale).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(stale.events.map((summary) => summary.title)).toEqual(["School fair"]);

    // Past the horizon there is nothing left to serve, and the family says so
    // rather than handing back older provider content.
    fixture.clock.ms = NOW.getTime() + 70 * MINUTE;
    expect(familyOf(await read(fixture, CAI), connection.id)).toMatchObject({
      state: "unavailable",
    });
  });

  it("goes unavailable when the connector's own provider connection does, designation intact", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    expect(readableFamily(await read(fixture, CAI), connection.id).events).toHaveLength(1);

    // ANA revokes Tendnote's Google access. Nobody touched the household.
    fixture.connectedConnectors.delete(ANA);

    expect(familyOf(await read(fixture, CAI), connection.id)).toMatchObject({
      state: "unavailable",
    });
    expect(
      await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: CAI }),
    ).toMatchObject([{ id: connection.id }]);
    expect(
      await fixture.store.calendars.getConnection({ connectionId: connection.id }),
    ).toMatchObject({ status: "connected", disconnectedReason: null });
  });
});

describe("household cache identity", () => {
  /**
   * The household path has its own cache identity (ADR 0217), and this is the
   * hardest case: the same connector, the same provider, the same capability, the
   * same calendar, and the same bounded window as an owner-scoped read. Every
   * component of the owner-scoped cache key is identical, so if the household
   * read reached the owner-scoped store it would serve the personal events.
   */
  it("does not share a cache with the connector's owner-scoped reads", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
      events: [event(FAMILY_CALENDAR, "evt-1", "Household event")],
    });

    const personalCache = createInMemoryCalendarCacheStore();
    const personalReader = createCalendarReader({
      adapter: createFakeCalendarAdapter([event(FAMILY_CALENDAR, "evt-9", "Personal event")]),
      cacheStore: personalCache,
      now: () => fixture.clock.ms,
    });
    await personalReader.readCalendarEvents({
      ownerUserId: ANA,
      providerKey: HOUSEHOLD_CALENDAR_PROVIDER,
      capabilityKey: HOUSEHOLD_CALENDAR_CAPABILITY,
      calendarId: FAMILY_CALENDAR,
      ...WINDOW,
    });

    expect(titlesFor(await read(fixture, CAI), connection.id)).toEqual(["Household event"]);
    expect(personalCache.entries().flatMap((entry) => entry.events.map((e) => e.title))).toEqual([
      "Personal event",
    ]);
  });

  it("keeps one connection's cache out of another's", async () => {
    await seed(fixture, [[ANA, "owner"]]);
    const family = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
      events: [event(FAMILY_CALENDAR, "evt-1", "School fair")],
    });
    const school = await designate(fixture, {
      calendarId: SCHOOL_CALENDAR,
      label: "School",
      events: [event(SCHOOL_CALENDAR, "evt-2", "Parents evening")],
    });
    await read(fixture, ANA);

    for (const [connectionId, calendarId] of [
      [family.id, FAMILY_CALENDAR],
      [school.id, SCHOOL_CALENDAR],
    ] as const) {
      const entries = fixture.store.calendars.cachedEntries({ connectionId });
      expect(entries).toHaveLength(1);
      expect(entries.map((entry) => entry.calendarId)).toEqual([calendarId]);
    }

    // Ending one designation empties its cache and nobody else's.
    await fixture.calendars.disconnectHouseholdCalendar({
      ownerUserId: ANA,
      connectionId: family.id,
    });
    expect(fixture.store.calendars.cachedEntries({ connectionId: family.id })).toEqual([]);
    expect(fixture.store.calendars.cachedEntries({ connectionId: school.id })).toHaveLength(1);
  });
});

describe("an owner stopping the sharing", () => {
  it("ends the designation, empties its cache, and closes the read in one step", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    await read(fixture, CAI);
    expect(fixture.store.calendars.cachedEntries({ connectionId: connection.id })).toHaveLength(1);

    expect(
      await fixture.calendars.disconnectHouseholdCalendar({
        ownerUserId: ANA,
        connectionId: connection.id,
      }),
    ).toEqual({ disconnected: true });

    expect(
      await fixture.store.calendars.getConnection({ connectionId: connection.id }),
    ).toMatchObject({
      status: "disconnected",
      disconnectedReason: "owner_disconnected",
      disconnectedAt: NOW,
    });
    expect(fixture.store.calendars.cachedEntries({ connectionId: connection.id })).toEqual([]);
    expect((await read(fixture, CAI)).families).toEqual([]);
    expect(await fixture.calendars.listHouseholdCalendarConnections({ callerUserId: CAI })).toEqual(
      [],
    );
    expect(await auditActions(fixture, ANA)).toContain("household.calendar.disconnect");

    // Pressing it again is not a second ending.
    expect(
      await fixture.calendars.disconnectHouseholdCalendar({
        ownerUserId: ANA,
        connectionId: connection.id,
      }),
    ).toEqual({ disconnected: false });
  });

  it("is an owner's decision, and names nothing when pointed elsewhere", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });

    await expect(
      fixture.calendars.disconnectHouseholdCalendar({
        ownerUserId: CAI,
        connectionId: connection.id,
      }),
    ).rejects.toThrow(/only a household owner can stop sharing/i);
    await expect(
      fixture.calendars.disconnectHouseholdCalendar({
        ownerUserId: ANA,
        connectionId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    expect(
      await fixture.store.calendars.getConnection({ connectionId: connection.id }),
    ).toMatchObject({ status: "connected" });
  });
});

describe("losing the member who was carrying the calendar", () => {
  /**
   * Reads once and pins that the connection's cache is populated, so the
   * "cache cleared" assertions below cannot pass against a cache that was never
   * written in the first place.
   */
  async function warmCache(callerUserId: string, ...connectionIds: string[]) {
    await read(fixture, callerUserId);
    for (const connectionId of connectionIds) {
      expect(fixture.store.calendars.cachedEntries({ connectionId })).toHaveLength(1);
    }
  }

  /** The state every loss-of-access case below is asserted against. */
  async function expectCalendarEnded(
    connectionId: string,
    reason: "connector_departed" | "household_dissolved",
  ) {
    expect(await fixture.store.calendars.getConnection({ connectionId })).toMatchObject({
      status: "disconnected",
      disconnectedReason: reason,
      disconnectedAt: NOW,
    });
    expect(fixture.store.calendars.cachedEntries({ connectionId })).toEqual([]);
  }

  /**
   * The Plan survives every one of them, untouched.
   *
   * Its content, its attribution, and its reference all stay: the contract is
   * that such a Plan shows an *unavailable* provider reference, which a Plan
   * holding no reference could not do. What must not survive is provider
   * content, and the caller has already asserted the cache is empty - the
   * address that remains is an address, and it now resolves to nothing.
   */
  async function expectPlanSurvivedWithUnreadableCalendar(
    planId: string,
    connectionId: string,
    /** Null when the household itself is gone, so nobody can read anything. */
    reader: string | null,
  ) {
    expect(
      fixture.eventPlanStore.allPlans().find((candidate) => candidate.id === planId),
    ).toMatchObject({
      title: "Saturday school fair",
      status: "active",
      createdByUserId: CAI,
      calendarConnectionId: connectionId,
      calendarId: FAMILY_CALENDAR,
      calendarProviderEventId: "evt-1",
    });
    if (!reader) return;
    // And the reference resolves to nothing for a member reading now, so the
    // Plan can only be rendered as pointing at something unavailable.
    expect(
      findHouseholdCalendarEvent(await read(fixture, reader), {
        connectionId,
        calendarId: FAMILY_CALENDAR,
        providerEventId: "evt-1",
      }),
    ).toBeNull();
  }

  it("disconnects the departing connector's calendars in the same operation", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      ownerUserId: BEN,
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    const plan = await planForEvent(fixture, connection.id);
    await warmCache(CAI, connection.id);

    await fixture.governance.leaveHousehold({ userId: BEN });

    await expectCalendarEnded(connection.id, "connector_departed");
    expect((await read(fixture, CAI)).families).toEqual([]);
    await expectPlanSurvivedWithUnreadableCalendar(plan.id, connection.id, CAI);
  });

  /**
   * The same by the other route. An Owner cannot be removed at all, so the only
   * way a connector is ever removed is the one written here: they step down
   * first, and then an Owner removes an ordinary member.
   */
  it("does the same when an owner removes the connector", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      ownerUserId: BEN,
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    const plan = await planForEvent(fixture, connection.id);
    await warmCache(CAI, connection.id);

    await fixture.governance.stepDownFromOwner({ userId: BEN });
    await fixture.governance.removeMember({ actorUserId: ANA, memberUserId: BEN });

    await expectCalendarEnded(connection.id, "connector_departed");
    expect((await read(fixture, CAI)).families).toEqual([]);
    await expectPlanSurvivedWithUnreadableCalendar(plan.id, connection.id, CAI);
  });

  it("leaves the household's calendars alone when someone who is not the connector leaves", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    const connection = await designate(fixture, {
      calendarId: FAMILY_CALENDAR,
      label: "Family",
    });
    const plan = await planForEvent(fixture, connection.id);
    await warmCache(CAI, connection.id);

    await fixture.governance.leaveHousehold({ userId: CAI });

    expect(
      await fixture.store.calendars.getConnection({ connectionId: connection.id }),
    ).toMatchObject({ status: "connected", disconnectedReason: null });
    expect(fixture.store.calendars.cachedEntries({ connectionId: connection.id })).toHaveLength(1);
    expect(readableFamily(await read(fixture, BEN), connection.id).events).toHaveLength(1);
    // The departed member's Plan stays, and keeps pointing at a calendar the
    // household can still read.
    expect(
      fixture.eventPlanStore.allPlans().find((candidate) => candidate.id === plan.id),
    ).toMatchObject({ createdByUserId: CAI, calendarConnectionId: connection.id });
  });

  it("disconnects every calendar and clears every cache when the household ends", async () => {
    await seed(fixture, [
      [ANA, "owner"],
      [BEN, "owner"],
      [CAI, "member"],
    ]);
    const family = await designate(fixture, { calendarId: FAMILY_CALENDAR, label: "Family" });
    const school = await designate(fixture, {
      ownerUserId: BEN,
      calendarId: SCHOOL_CALENDAR,
      label: "School",
    });
    const plan = await planForEvent(fixture, family.id);
    await warmCache(CAI, family.id, school.id);

    await fixture.governance.confirmDissolution({ ownerUserId: ANA });
    const state = await fixture.governance.confirmDissolution({ ownerUserId: BEN });

    expect(state.dissolved).toMatchObject({ disconnectedCalendars: 2 });
    await expectCalendarEnded(family.id, "household_dissolved");
    await expectCalendarEnded(school.id, "household_dissolved");
    // Nothing provider-derived is reachable, by anyone, through any surface.
    for (const callerUserId of [ANA, BEN, CAI]) {
      await expect(read(fixture, callerUserId)).rejects.toBeInstanceOf(
        HouseholdRecordUnavailableError,
      );
    }
    await expectPlanSurvivedWithUnreadableCalendar(plan.id, family.id, null);
  });
});
