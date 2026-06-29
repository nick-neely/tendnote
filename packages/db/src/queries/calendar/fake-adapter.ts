import type { CalendarEventSummary } from "@tendnote/domain";
import type { CalendarProviderAdapter, CalendarProviderReadInput } from "./types";

export type FakeCalendarAdapter = CalendarProviderAdapter & {
  /** Read inputs the adapter was called with, for assertions. */
  calls: CalendarProviderReadInput[];
};

/**
 * Deterministic fake Calendar provider adapter for normal tests (ADR-0075): never
 * calls Google. Accepts either a fixed list of summaries or a function of the read
 * input, and records every call.
 */
export function createFakeCalendarAdapter(
  events: CalendarEventSummary[] | ((input: CalendarProviderReadInput) => CalendarEventSummary[]),
): FakeCalendarAdapter {
  const calls: CalendarProviderReadInput[] = [];
  return {
    calls,
    async listEvents(input) {
      calls.push(input);
      return typeof events === "function" ? events(input) : events;
    },
  };
}

/** Fake adapter that always fails — for exercising stale-cache fallback (ADR-0081). */
export function createFailingCalendarAdapter(
  error: Error = new Error("calendar provider unavailable"),
): CalendarProviderAdapter {
  return {
    async listEvents() {
      throw error;
    },
  };
}
