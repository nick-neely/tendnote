"use server";

import {
  connectHouseholdCalendar,
  disconnectHouseholdCalendar,
} from "@tendnote/db/queries/household-calendar";
import { DEFAULT_CALENDAR_ID } from "@tendnote/domain";
import { HOUSEHOLD_CALENDAR_LABEL_LIMIT } from "@tendnote/domain/household-calendar";
import { z } from "zod";
import {
  type HouseholdCalendarSurface,
  readHouseholdCalendarSurface,
  viewerHasHouseholdCalendarAccess,
} from "@/lib/household/household-shared-data";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Household Calendar Connection mutations (issue #387, ADR 0217).
 *
 * Both of these change what every current *and future* active member of the
 * household can read, which is why the lifecycle behind them is Owner-only and
 * why each answers with the whole refreshed surface rather than the row it
 * touched: connecting adds a calendar whose events have to be read before they
 * can be shown, and disconnecting removes a calendar and its cache in the same
 * step. A surface recomputing either from a single row would be guessing at the
 * answer that matters most.
 *
 * Neither takes a household id, and neither takes the connector's identity: the
 * caller is the connector, resolved from their own session by the action gate.
 */
export type HouseholdCalendarResult = OwnerActionResult<HouseholdCalendarSurface>;

const connectSchema = z
  .object({ label: z.string().min(1).max(HOUSEHOLD_CALENDAR_LABEL_LIMIT) })
  .strict();
const disconnectSchema = z.object({ connectionId: z.string().min(1).max(200) }).strict();

const accountScope = (_result: unknown, ownerUserId: string) =>
  [{ kind: "owner-collection" as const, collection: "account" as const, ownerUserId }] as const;

/**
 * Designates one of the caller's own calendars as readable by the whole
 * household.
 *
 * The calendar is the connector's primary Google Calendar for now, so there is
 * nothing in the request that names a calendar: a payload that could is a
 * payload that could name someone else's. `connectorHasCalendarAccess` is
 * resolved server-side for the same reason - it is a fact about the caller's own
 * provider grant, and a client asserting it would designate a calendar Tendnote
 * has no way to read.
 */
export async function connectHouseholdCalendarAction(input: {
  label: string;
}): Promise<HouseholdCalendarResult> {
  return runOwnerAction({
    schema: connectSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await connectHouseholdCalendar({
        ownerUserId,
        calendarId: DEFAULT_CALENDAR_ID,
        label: parsed.label,
        connectorHasCalendarAccess: await viewerHasHouseholdCalendarAccess(ownerUserId),
      });
      return readHouseholdCalendarSurface(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (surface) => surface,
  });
}

/**
 * Stops sharing one calendar. The lifecycle clears its provider cache in the
 * same call, so there is no window in which a disconnected calendar's events are
 * still readable, and it refuses a connection that is not this household's with
 * the same opaque sentence it uses for one that never existed.
 */
export async function disconnectHouseholdCalendarAction(input: {
  connectionId: string;
}): Promise<HouseholdCalendarResult> {
  return runOwnerAction({
    schema: disconnectSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await disconnectHouseholdCalendar({ ownerUserId, connectionId: parsed.connectionId });
      return readHouseholdCalendarSurface(ownerUserId);
    },
    affectedScopes: accountScope,
    result: (surface) => surface,
  });
}
