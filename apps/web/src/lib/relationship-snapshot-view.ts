import type { PersonContextSnapshotResult } from "@tendnote/db/queries/context-snapshots";
import { sanitizeSnapshotSummary } from "./snapshot-summary-prose";

/**
 * A correction affordance: where on the profile a user goes to change what the
 * snapshot says. Phase 1B uses record-level routing (ADR 0009/0030) — corrections
 * happen on the underlying records, never by editing generated snapshot text.
 */
export type SnapshotCorrectionTarget = {
  kind: "person" | "memory" | "source_record" | "suggested_memory" | "followup";
  // Ready-to-render link text, e.g. "your profile" or "2 notes".
  text: string;
  count: number;
  href: string;
};

export type RelationshipSnapshotFollowupView = {
  id: string;
  status: string;
  dueAt: string;
  reason: string;
};

/**
 * Read-only view of the relationship snapshot card. Built from the shared
 * snapshot-backed read path so the web card and Eve agree on what the snapshot
 * says (PRD #11). The card never edits snapshot text — it only displays the
 * generated summary and routes corrections to the underlying records.
 */
export type RelationshipSnapshotView = {
  status: "fresh" | "rebuilt" | "fallback";
  // True when no usable snapshot is available, so the profile should lean on the
  // trust-aware sections below rather than a generated summary.
  fallback: boolean;
  summary: string | null;
  generatedAtLabel: string | null;
  followups: RelationshipSnapshotFollowupView[];
  // Record-level affordances for inspecting/correcting what the summary is built
  // from. Suggested memories are kept out of this durable set — see below.
  corrections: SnapshotCorrectionTarget[];
  // Tentative observations still under review, surfaced separately from the
  // durable summary so they are never read as confirmed facts (ADR 0009).
  suggestedMemoryCount: number;
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Projects a snapshot read result into the read-only card view. On fallback
 * (missing, stale, or failed snapshot) the summary is withheld so stale generated
 * prose is never shown as current; the profile's trust-aware sections remain the
 * fallback context (ADR 0009 fail-open).
 */
export function toRelationshipSnapshotView(
  result: PersonContextSnapshotResult,
): RelationshipSnapshotView {
  const fallback = result.status === "fallback" || result.snapshot === null;
  const snapshot = fallback ? null : result.snapshot;

  const corrections: SnapshotCorrectionTarget[] = [];
  if (snapshot) {
    const refs = snapshot.supportingReferences;
    if (refs.personIds.length > 0) {
      // The summary leads with the person's relationship type and profile, so the
      // profile header is the route for correcting that framing (#17).
      corrections.push({
        kind: "person",
        text: "your profile",
        count: refs.personIds.length,
        href: "#person-header",
      });
    }
    if (refs.memoryIds.length > 0) {
      const count = refs.memoryIds.length;
      corrections.push({
        kind: "memory",
        text: `${count} ${pluralize(count, "memory", "memories")}`,
        count,
        href: "#memories",
      });
    }
    if (refs.sourceRecordIds.length > 0) {
      const count = refs.sourceRecordIds.length;
      corrections.push({
        kind: "source_record",
        text: `${count} ${pluralize(count, "note", "notes")}`,
        count,
        href: "#logged-context",
      });
    }
    if (snapshot.followups.length > 0) {
      const count = snapshot.followups.length;
      corrections.push({
        kind: "followup",
        text: `${count} ${pluralize(count, "follow-up", "follow-ups")}`,
        count,
        href: "#follow-ups",
      });
    }
  }

  // Generated prose can leak Markdown; normalize it to clean plain text for the
  // read-only card (the card renders text, not Markdown). An empty result after
  // stripping chrome falls back rather than showing a blank summary.
  const summary = snapshot ? sanitizeSnapshotSummary(snapshot.summary) || null : null;

  return {
    status: result.status,
    fallback,
    summary,
    generatedAtLabel: snapshot
      ? snapshot.generatedAt.toLocaleDateString(undefined, DATE_FORMAT)
      : null,
    followups: snapshot
      ? snapshot.followups.map((followup) => ({
          id: followup.id,
          status: followup.status,
          dueAt: new Date(followup.dueAt).toLocaleDateString(undefined, DATE_FORMAT),
          reason: followup.reason,
        }))
      : [],
    corrections,
    suggestedMemoryCount: snapshot?.supportingReferences.suggestedMemoryIds.length ?? 0,
  };
}
