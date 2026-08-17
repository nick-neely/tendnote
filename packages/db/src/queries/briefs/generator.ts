import {
  type BriefCadence,
  type BriefGenerationReason,
  type BriefItem,
  type BriefSummaryInput,
  type BriefWithItems,
  briefItemIdentityKeys,
  type CreateBriefItemInput,
  isBriefItemFeedbackActive,
  normalizeItemScope,
} from "@tendnote/domain";
import type { CalendarReaderForOwner } from "../calendar";
import type {
  RelationshipAgendaCandidate,
  RelationshipAgendaInput,
  RelationshipAgendaKind,
} from "../relationship-agenda/types";
import {
  type BriefCalendarContextProvider,
  type BriefCalendarHighlight,
  createCalendarBriefContextProvider,
} from "./calendar-context";
import type { BriefSummaryAdapter } from "./summary-adapter";
import type { BriefStore } from "./types";

/** Optional generator dependencies. The summary adapter decorates only (issue #73). */
export type BriefGeneratorOptions = {
  summaryAdapter?: BriefSummaryAdapter;
  /**
   * Provider-derived Google Calendar highlights for the brief window (Phase 2C,
   * #112). Optional and best-effort: a disconnected/unavailable calendar (or a
   * thrown error) simply yields no calendar items, so briefs degrade gracefully.
   */
  calendarContext?: BriefCalendarContextProvider;
};

type GeneratedSummary = {
  summary: string | null;
  summaryProvenance: Record<string, unknown> | null;
};

/**
 * Runs the optional decorative summary adapter over the already-selected items
 * (PRD #65, issue #73). It is fail-open: a missing adapter, no items, empty
 * output, or a thrown adapter error all yield no summary, so the brief is always
 * created with its deterministic items regardless of summary success.
 */
async function buildSummary(
  adapter: BriefSummaryAdapter | undefined,
  input: BriefSummaryInput,
): Promise<GeneratedSummary> {
  if (!adapter || input.items.length === 0) {
    return { summary: null, summaryProvenance: null };
  }

  try {
    const result = await adapter(input);

    if (!result || result.summary.trim().length === 0) {
      return { summary: null, summaryProvenance: null };
    }

    return { summary: result.summary.trim(), summaryProvenance: result.provenance ?? null };
  } catch {
    return { summary: null, summaryProvenance: null };
  }
}

/**
 * Reads provider-derived Calendar highlights for the brief window and snapshots
 * them into bounded brief items (#112). Fail-open: a missing provider, no events,
 * or a thrown error all yield no calendar items, so the brief is still created
 * with its deterministic agenda items (ADR-0081).
 */
async function buildCalendarItems(
  provider: BriefCalendarContextProvider | undefined,
  input: {
    ownerUserId: string;
    windowStart: Date;
    windowEnd: Date;
    limit: number;
    startRank: number;
  },
): Promise<CreateBriefItemInput[]> {
  if (!provider || input.limit <= 0) {
    return [];
  }
  try {
    const highlights = await provider({
      ownerUserId: input.ownerUserId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      limit: input.limit,
    });
    return highlights
      .slice(0, input.limit)
      .map((highlight, index) =>
        toCalendarBriefItem(input.ownerUserId, highlight, input.startRank + index),
      );
  } catch {
    return [];
  }
}

/**
 * Read-only relationship agenda surface the generator selects candidates from
 * (PRD #65, ADR-0062). The agenda is the bridge from broad ranking to persisted
 * brief items; the generator never queries records directly.
 */
export type BriefAgendaSource = {
  getRelationshipAgenda: (input: RelationshipAgendaInput) => Promise<RelationshipAgendaCandidate[]>;
};

/**
 * Per-cadence selection policy. Daily and weekly share one artifact model and
 * differ only here: agenda window, item cap, ranking depth (how many candidates
 * the agenda ranks before the cap), and candidate breadth. The daily brief stays
 * a calm 1–3 item prompt; the weekly review widens the window, cap, and breadth
 * to surface stale and lower-priority relationship context (PRD #65).
 */
const CADENCE_CONFIG: Record<
  BriefCadence,
  {
    windowDays: number;
    itemCap: number;
    agendaLimit: number;
    includeKinds: RelationshipAgendaKind[];
    // Max provider-derived Calendar highlights appended to the brief (#112). Kept
    // small so the daily brief stays a calm prompt rather than a full agenda.
    calendarCap: number;
  }
> = {
  daily: {
    windowDays: 1,
    itemCap: 3,
    agendaLimit: 8,
    includeKinds: ["due_followup", "birthday", "suggested_followup", "review_item"],
    calendarCap: 2,
  },
  weekly: {
    windowDays: 7,
    itemCap: 10,
    agendaLimit: 25,
    // Weekly adds recent lower-priority context on top of the daily breadth.
    includeKinds: [
      "due_followup",
      "birthday",
      "suggested_followup",
      "review_item",
      "recent_context",
    ],
    calendarCap: 4,
  },
};

export type GenerateBriefInput = {
  ownerUserId: string;
  cadence: BriefCadence;
  // Local calendar date the brief covers, formatted YYYY-MM-DD.
  localDate: string;
  // Scheduled (cron), manual (web), or regenerated. Defaults to scheduled.
  generationReason?: BriefGenerationReason;
  // When true, supersede the current brief and generate a fresh one even if a
  // current brief already exists; otherwise a duplicate run returns the existing
  // brief (idempotent per owner/local date/cadence).
  regenerate?: boolean;
  // The explicit "ignore prior feedback" escape hatch (PRD #65, ADR-0008): when
  // true, reselection does not suppress dismissed/snoozed/acted-on candidates.
  // Normal generation and regeneration leave this false so feedback is respected.
  ignorePriorFeedback?: boolean;
  // Injectable clock for deterministic tests.
  now?: Date;
  /** Runtime-owned Calendar reader composition for live cache misses. */
  calendarReaderFor?: CalendarReaderForOwner;
};

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Builds the set of identity keys that prior feedback suppresses (PRD #65, issue
 * #68, ADR-0008). A candidate is suppressed when it shares a key with a prior
 * dismissed, acted-on, or still-snoozed item — i.e. the same kind, the same
 * person, and at least one shared source reference. Expired snoozes and prior
 * active items do not suppress, so the candidate can reappear.
 */
function buildSuppressedKeys(priorItems: BriefItem[], now: Date): Set<string> {
  const suppressed = new Set<string>();

  for (const item of priorItems) {
    if (!isBriefItemFeedbackActive(item, now)) {
      continue;
    }

    for (const key of briefItemIdentityKeys({
      kind: item.kind,
      personId: item.personId,
      sourceRefs: item.sourceRefs,
    })) {
      suppressed.add(key);
    }
  }

  return suppressed;
}

function isSuppressed(candidate: RelationshipAgendaCandidate, suppressed: Set<string>): boolean {
  return briefItemIdentityKeys({
    kind: candidate.kind,
    personId: candidate.personId,
    sourceRefs: candidate.sourceRefs.map((ref) => ({ kind: ref.kind, id: ref.id })),
  }).some((key) => suppressed.has(key));
}

/**
 * Snapshots a ranked, filtered agenda candidate into a persisted brief item.
 * Render-time code reads these fields and never recomputes title/reason/rank from
 * the live agenda query (PRD #65). The agenda candidate's source refs, trust
 * level, and sensitivity carry through unchanged so grounding and policy survive.
 */
function toBriefItem(
  ownerUserId: string,
  candidate: RelationshipAgendaCandidate,
  rank: number,
): CreateBriefItemInput {
  return {
    ownerUserId,
    kind: candidate.kind,
    personId: candidate.personId,
    personDisplayName: candidate.personDisplayName,
    title: candidate.title,
    reason: candidate.reason,
    dueAt: candidate.dueAt ?? null,
    sourceRefs: candidate.sourceRefs.map((ref) => ({ kind: ref.kind, id: ref.id })),
    trustLevel: candidate.trustLevel,
    sensitivity: candidate.sensitivity,
    // Snapshot the backing record's disclosure scope so scheduled-workflow delivery
    // can aggregate the brief's household-safety (ADR-0142). Candidates with no
    // scoped backing record (person-derived birthdays) carry no scope and fail
    // closed to `private`.
    ...normalizeItemScope(candidate),
    rank,
    status: "active",
    snoozedUntil: null,
  };
}

/**
 * Snapshots a provider-derived Calendar highlight into a brief item (#112). Marked
 * `calendar_event` with `logged_context` trust so it reads as read-only provider
 * context, never approved memory or an active follow-up. It carries no person link
 * or source ref (Calendar attendees are matched/promoted only by later, explicit
 * workflows — ADR-0078) and no raw provider payload. These items live only on the
 * brief surface and never enter full-text/semantic retrieval (ADR-0079), which
 * covers approved memories and retained source records only.
 *
 * Sensitivity is `normal`: a calendar event is the OWNER's own schedule shown back
 * to them in their OWN private brief — unlike a third-party memory, so the ADR-0058
 * restricted filter (which gates classified relationship memories) does not apply.
 */
function toCalendarBriefItem(
  ownerUserId: string,
  highlight: BriefCalendarHighlight,
  rank: number,
): CreateBriefItemInput {
  return {
    ownerUserId,
    kind: "calendar_event",
    personId: null,
    personDisplayName: null,
    title: highlight.title,
    reason: highlight.reason,
    dueAt: highlight.start,
    sourceRefs: [],
    trustLevel: "logged_context",
    sensitivity: "normal",
    // A calendar highlight is the owner's own schedule shown back to them in their
    // own brief — owner-private, never household-shareable to a broader audience.
    scope: "private",
    householdId: null,
    rank,
    status: "active",
    snoozedUntil: null,
  };
}

/**
 * Shared owner-scoped brief generator (PRD #65, issue #67). This is the single
 * seam dashboard actions, manual generation, and schedule dispatch all call, so
 * business rules cannot fork. Item selection is deterministic and source-backed:
 * the relationship agenda ranks candidates, the generator excludes restricted
 * content, snapshots the selected candidate fields, and persists them. It never
 * asks a model to select or rank items, and it has no semantic/embedding
 * dependency (briefs pass no query, so the agenda's semantic path never runs),
 * keeping briefs useful when embeddings are missing or stale.
 *
 * Regeneration supersedes-and-replaces, and reselection honors prior brief-item
 * feedback (issue #68, ADR-0008): candidates that match a prior dismissed,
 * acted-on, or still-snoozed item by source/person/kind are suppressed so cleared
 * items do not immediately reappear. Suppression reads prior items only — it never
 * mutates the underlying memory, source record, or follow-up.
 */
export function createBriefGenerator(
  store: BriefStore,
  agenda: BriefAgendaSource,
  options: BriefGeneratorOptions = {},
) {
  return {
    async generateBrief(input: GenerateBriefInput): Promise<BriefWithItems> {
      const now = input.now ?? new Date();
      const config = CADENCE_CONFIG[input.cadence];

      const existing = await store.findCurrentBrief({
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
        cadence: input.cadence,
      });

      // Idempotent by owner/local date/cadence: a duplicate scheduled or manual
      // run returns the existing brief unless the caller explicitly regenerates.
      if (existing && !input.regenerate) {
        return existing;
      }

      if (existing && input.regenerate) {
        await store.supersedeCurrentBrief({
          ownerUserId: input.ownerUserId,
          localDate: input.localDate,
          cadence: input.cadence,
          supersededAt: now,
        });
      }

      // The window is anchored to the local date in UTC, matching the relationship
      // agenda's own UTC date math. Mapping the owner's timezone to the correct
      // local date to generate is the schedule dispatcher's job (issue #72,
      // ADR-0066); the generator stays timezone-agnostic given a local date.
      const windowStart = new Date(`${input.localDate}T00:00:00.000Z`);
      const windowEnd = addUtcDays(windowStart, config.windowDays);

      const [candidates, priorItems] = await Promise.all([
        agenda.getRelationshipAgenda({
          ownerUserId: input.ownerUserId,
          windowStart,
          windowEnd,
          includeKinds: config.includeKinds,
          limit: config.agendaLimit,
        }),
        // Prior cleared brief items across this owner/cadence carry the feedback
        // (PRD #65, issue #68). The store filters to cleared statuses; snooze
        // expiry is still resolved per-item below. Reading them keeps suppression
        // local to the brief surface — the underlying memory, source record, and
        // follow-up are never touched. Skipped entirely when the caller explicitly
        // asks to ignore prior feedback (ADR-0008 escape hatch).
        input.ignorePriorFeedback
          ? Promise.resolve([])
          : store.listBriefItemsForOwner({
              ownerUserId: input.ownerUserId,
              cadence: input.cadence,
              statuses: ["dismissed", "snoozed", "acted_on"],
            }),
      ]);

      const suppressed = buildSuppressedKeys(priorItems, now);

      const agendaItems = candidates
        // Restricted content is never surfaced in proactive briefs (ADR-0058).
        .filter((candidate) => candidate.sensitivity !== "restricted")
        // Cleared candidates (dismissed/snoozed/acted-on) do not immediately return.
        .filter((candidate) => !isSuppressed(candidate, suppressed))
        .slice(0, config.itemCap)
        .map((candidate, index) => toBriefItem(input.ownerUserId, candidate, index + 1));

      // Provider-derived Calendar highlights (#112). Best-effort and bounded: a
      // disconnected/unavailable calendar or any read error yields none, so the
      // brief is always created with its deterministic items (ADR-0081). Appended
      // after the agenda items so Calendar context never displaces follow-ups.
      const calendarContext = input.calendarReaderFor
        ? createCalendarBriefContextProvider({ readerFor: input.calendarReaderFor })
        : options.calendarContext;
      const calendarItems = await buildCalendarItems(calendarContext, {
        ownerUserId: input.ownerUserId,
        windowStart,
        windowEnd,
        limit: config.calendarCap,
        startRank: agendaItems.length + 1,
      });

      const items = [...agendaItems, ...calendarItems];

      const generationReason: BriefGenerationReason = input.regenerate
        ? "regenerated"
        : (input.generationReason ?? "scheduled");

      // Decorative summary runs after deterministic selection and never feeds back
      // into items, ranks, or source refs (ADR-0008). Fail-open: no summary on error.
      const { summary, summaryProvenance } = await buildSummary(options.summaryAdapter, {
        cadence: input.cadence,
        items: items.map((item) => ({
          kind: item.kind,
          personDisplayName: item.personDisplayName,
          title: item.title,
          reason: item.reason,
        })),
      });

      return store.createBrief({
        ownerUserId: input.ownerUserId,
        cadence: input.cadence,
        localDate: input.localDate,
        generationReason,
        generatedAt: now,
        windowStart,
        windowEnd,
        summary,
        summaryProvenance,
        supersededAt: null,
        items,
      });
    },
  };
}
