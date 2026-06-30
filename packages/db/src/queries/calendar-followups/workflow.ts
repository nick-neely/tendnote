import { DEFAULT_CALENDAR_ID, PROVIDER_GOOGLE } from "@tendnote/domain";
import {
  type CalendarReader,
  type OwnerCalendarReadOutcome,
  readConnectedOwnerCalendar,
} from "../calendar";
import type { CalendarReadRequest } from "../calendar/types";
import type { CalendarSuggestionReview } from "./suggestions";
import type { CalendarPeopleMatcher, CalendarSuggestionClassifier } from "./types";

const CALENDAR_CAPABILITY = "calendar";
const DEFAULT_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
const DEFAULT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 25;

export type CalendarSuggestionWorkflowResult = {
  connected: boolean;
  generated: number;
};

export type CalendarSuggestionWorkflow = {
  runCalendarSuggestionWorkflow: (input: {
    ownerUserId: string;
    now?: Date;
    classify?: CalendarSuggestionClassifier;
  }) => Promise<CalendarSuggestionWorkflowResult>;
};

/**
 * Bounded production workflow for Calendar-derived follow-up suggestions (#117).
 * It reads minimized events through the shared Calendar reader/cache seam, then
 * hands those summaries to the deterministic suggestion generator. It is
 * schedule-shaped and best-effort: no queue topic, broad sync loop, raw payload
 * warehouse, active follow-up, source record, memory, draft, person, or external
 * action is created here.
 */
export function createCalendarSuggestionWorkflow(deps: {
  readerFor: (ownerUserId: string) => CalendarReader;
  review: CalendarSuggestionReview;
  matcher: CalendarPeopleMatcher;
  read?: (
    input: CalendarReadRequest,
    deps: {
      reader: CalendarReader;
      isConnected?: (ref: {
        ownerUserId: string;
        providerKey: string;
        capabilityKey: string;
      }) => Promise<boolean>;
    },
  ) => Promise<OwnerCalendarReadOutcome>;
  isConnected?: (ref: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<boolean>;
  lookbackMs?: number;
  lookaheadMs?: number;
  maxResults?: number;
}): CalendarSuggestionWorkflow {
  const read = deps.read ?? readConnectedOwnerCalendar;

  return {
    async runCalendarSuggestionWorkflow(input) {
      const now = input.now ?? new Date();
      const outcome = await read(
        {
          ownerUserId: input.ownerUserId,
          providerKey: PROVIDER_GOOGLE,
          capabilityKey: CALENDAR_CAPABILITY,
          calendarId: DEFAULT_CALENDAR_ID,
          timeMin: new Date(now.getTime() - (deps.lookbackMs ?? DEFAULT_LOOKBACK_MS)),
          timeMax: new Date(now.getTime() + (deps.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS)),
          maxResults: deps.maxResults ?? DEFAULT_MAX_RESULTS,
          query: null,
        },
        {
          reader: deps.readerFor(input.ownerUserId),
          isConnected: deps.isConnected,
        },
      );

      if (!outcome.connected || !outcome.result) {
        return { connected: outcome.connected, generated: 0 };
      }

      const created = await deps.review.generateSuggestions(
        { ownerUserId: input.ownerUserId, events: outcome.result.events, now },
        { matcher: deps.matcher, classify: input.classify },
      );

      return { connected: true, generated: created.length };
    },
  };
}
