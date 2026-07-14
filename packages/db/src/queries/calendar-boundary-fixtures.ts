import { expect } from "vitest";
import { semanticRecordKind } from "../schema";

/**
 * Asserts that Calendar is not a semantic record kind — the shared Calendar-boundary
 * check, spelled once (#204).
 *
 * Deliberately lives *outside* `queries/calendar/`: both Calendar suites assert that the
 * Calendar seam directory imports no retrieval or embedding machinery at all, and this
 * fixture names exactly that machinery. Keeping it here is what lets the boundary it
 * guards stay true of the directory it guards.
 *
 * Cached and derived Calendar context is never embedded; it enters retrieval only after
 * explicit promotion into a durable record (ADR-0079). This is the *negative* half of the
 * guard: it says what must stay out, whatever else the index grows to hold.
 *
 * Its counterpart is the exact-list assertion in
 * `semantic-retrieval/migration-shape.test.ts`, which pins the embedded kinds precisely.
 * The two work together, and neither replaces the other: this one cannot be satisfied by
 * a Calendar kind under a different name, and the exact list forces any new kind through
 * a deliberate edit — and so through this question.
 */
export function expectCalendarIsNotASemanticRecordKind(): void {
  const kinds: string[] = [...semanticRecordKind.enumValues];

  expect(kinds).not.toContain("calendar_event");
  // Name-shaped guard as well as the literal one, so a rename cannot slip past it.
  expect(kinds.some((kind) => /calendar|event|meeting|gcal/.test(kind))).toBe(false);
}
