import "server-only";

import { listActiveFollowups } from "@tendnote/db/queries/followups";
import { listActiveGeneralActions } from "@tendnote/db/queries/general-actions";
import {
  createHouseholdCalendarReaderFor,
  listHouseholdCalendarConnections,
  readHouseholdCalendars,
} from "@tendnote/db/queries/household-calendar";
import {
  type HouseholdEventPlanWithLinks,
  listHouseholdEventPlans,
} from "@tendnote/db/queries/household-event-plans";
import { isProviderCapabilityConnected } from "@tendnote/db/queries/provider-connections";
import { listSavedItems } from "@tendnote/db/queries/saved-items";
import {
  HOUSEHOLD_CALENDAR_CAPABILITY,
  HOUSEHOLD_CALENDAR_PROVIDER,
  type HouseholdCalendarConnectionSummary,
  type HouseholdCalendarRead,
} from "@tendnote/domain/household-calendar";
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";
import type { HouseholdEventPlanLinkCandidate } from "@/lib/household/household-event-plan-view";
import { createWebGoogleCalendarAccessTokenProvider } from "@/lib/integrations/calendar-runtime";

/**
 * The server reads behind the Household's Calendar and Event Plan planning
 * region (issue #387).
 *
 * Every read here is authorized inside its own domain seam - none of these
 * entry points takes a household id, and each obtains its own Household
 * Authorization Proof (ADR 0219). What this module adds is failure isolation:
 * the Phase Eight contract says one failing Calendar cannot hide a working one
 * *or* the Event Plans, so the three reads are attempted independently and a
 * failure in any of them degrades only its own section.
 */

/**
 * The window a household glance covers: an hour back, so a gathering already
 * under way is still there, and a fortnight forward, which is about as far as a
 * household plans a school night or a birthday.
 */
const HOUSEHOLD_CALENDAR_LOOKBACK_MS = 60 * 60 * 1000;
const HOUSEHOLD_CALENDAR_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
/** Read a little wider than any one calendar shows, so its rows are the soonest. */
const HOUSEHOLD_CALENDAR_MAX_RESULTS = 12;

/**
 * How many of each family the link picker offers.
 *
 * Short enough to be read rather than searched: this is "the thing I just made",
 * not a record browser. Someone whose record is not among them can still say so
 * in the Plan's own notes.
 */
const HOUSEHOLD_EVENT_PLAN_CANDIDATES_PER_KIND = 8;

export type HouseholdCalendarSurface = {
  connections: HouseholdCalendarConnectionSummary[];
  read: HouseholdCalendarRead;
};

export type HouseholdSharedContext = {
  /** Fixed once per render so the server's freshness labels and the client's agree. */
  now: Date;
  /** `null` when the designated calendars could not be listed at all. */
  calendars: HouseholdCalendarSurface | null;
  /** `null` when this household's Plans could not be read. Independent of the above. */
  plans: HouseholdEventPlanWithLinks[] | null;
  /** The reader's own records, for the Plan link picker. Empty is a real answer. */
  linkCandidates: HouseholdEventPlanLinkCandidate[];
  /**
   * Whether the reader's own Google Calendar is connected.
   *
   * Only ever used to decide what an Owner is offered: a member reads an
   * authorized Household Calendar whether or not they have one of their own
   * (ADR 0217). The connect mutation resolves this fact again for itself.
   */
  viewerHasCalendarAccess: boolean;
};

/**
 * Whether this user's own Google Calendar capability is connected.
 *
 * The same persisted Provider Connection gate the Account preview reads through,
 * and never a claim from a request: a designation rides the connector's personal
 * grant, so a household calendar designated without one would be unreadable the
 * moment it was made.
 */
export async function viewerHasHouseholdCalendarAccess(userId: string): Promise<boolean> {
  if (!isGoogleConfigured(googleEnvFromProcess())) return false;
  try {
    return await isProviderCapabilityConnected({
      ownerUserId: userId,
      providerKey: HOUSEHOLD_CALENDAR_PROVIDER,
      capabilityKey: HOUSEHOLD_CALENDAR_CAPABILITY,
    });
  } catch {
    return false;
  }
}

/**
 * This household's designated calendars and one bounded read of them.
 *
 * A read that fails wholesale is turned into one `unavailable` family per
 * designated calendar rather than an empty surface: the household did designate
 * these calendars, and "nothing is shared here" would be a different and untrue
 * answer.
 */
export async function readHouseholdCalendarSurface(
  callerUserId: string,
): Promise<HouseholdCalendarSurface> {
  const connections = await listHouseholdCalendarConnections({ callerUserId });
  const now = new Date();

  try {
    const read = await readHouseholdCalendars(
      {
        callerUserId,
        timeMin: new Date(now.getTime() - HOUSEHOLD_CALENDAR_LOOKBACK_MS),
        timeMax: new Date(now.getTime() + HOUSEHOLD_CALENDAR_LOOKAHEAD_MS),
        maxResults: HOUSEHOLD_CALENDAR_MAX_RESULTS,
      },
      {
        readerFor: createHouseholdCalendarReaderFor(createWebGoogleCalendarAccessTokenProvider()),
      },
    );
    return { connections, read };
  } catch {
    return {
      connections,
      read: {
        families: connections.map((connection) => ({
          connectionId: connection.id,
          label: connection.label,
          state: "unavailable" as const,
        })),
      },
    };
  }
}

/**
 * This household's Plans, active and archived, for the reader who asked.
 *
 * Each one arrives with the links that reader was proved for, which is why this
 * is per-reader rather than per-household: the Plan is the same for everyone,
 * and the links on it are not.
 */
export async function readHouseholdEventPlans(
  callerUserId: string,
): Promise<HouseholdEventPlanWithLinks[]> {
  return listHouseholdEventPlans({ callerUserId });
}

/**
 * The records this member could link to a Plan.
 *
 * Read through each family's own owner-scoped entry point, so what comes back is
 * what this caller may already see - in practice their own records. The link
 * mutation proves the target again for itself, so nothing here is a permission;
 * it is a shortlist of presses that will work.
 *
 * Each family is read independently and a failing one contributes nothing rather
 * than emptying the picker, the same isolation the calendars get: a Follow-Up
 * read that is down must not make it look as though the member has no Actions.
 *
 * It runs on every render of this surface, alongside the calendar read rather
 * than behind the press that opens a picker, so the picker opens on the spot.
 * The per-family cap is what makes that affordable: these entry points hydrate
 * each record they return, so the bound is on rows, not just on rendering.
 */
async function readHouseholdEventPlanLinkCandidates(
  callerUserId: string,
): Promise<HouseholdEventPlanLinkCandidate[]> {
  const limit = HOUSEHOLD_EVENT_PLAN_CANDIDATES_PER_KIND;
  const [actions, followups, saved] = await Promise.all([
    listActiveGeneralActions({ ownerUserId: callerUserId, limit }).catch(() => []),
    listActiveFollowups({ ownerUserId: callerUserId, limit }).catch(() => []),
    listSavedItems({ callerUserId, limit }).catch(() => []),
  ]);

  return [
    ...actions.map((action) => ({
      kind: "general_action" as const,
      id: action.id,
      title: action.title,
    })),
    // A Follow-Up has no title. Its `reason` is the line a member wrote to name
    // it, and the person it concerns is deliberately left off: a Plan naming
    // someone is #388's Person Reference, not a side effect of a link label.
    ...followups.map(({ followup }) => ({
      kind: "followup" as const,
      id: followup.id,
      title: followup.reason,
    })),
    ...saved.map((item) => ({ kind: "saved_item" as const, id: item.id, title: item.title })),
  ];
}

/**
 * Everything the two shared sections render, gathered for one active member.
 *
 * Each read is isolated, so a member always sees as much as is actually
 * readable: broken calendars never take the Plans down, and unreadable Plans
 * never take the calendars down.
 */
export async function getHouseholdSharedContext(
  callerUserId: string,
): Promise<HouseholdSharedContext> {
  const [calendars, plans, linkCandidates, viewerHasCalendarAccess] = await Promise.all([
    readHouseholdCalendarSurface(callerUserId).catch(() => null),
    readHouseholdEventPlans(callerUserId).catch(() => null),
    readHouseholdEventPlanLinkCandidates(callerUserId).catch(() => []),
    viewerHasHouseholdCalendarAccess(callerUserId),
  ]);

  return { now: new Date(), calendars, plans, linkCandidates, viewerHasCalendarAccess };
}
