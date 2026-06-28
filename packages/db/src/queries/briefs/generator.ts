import type {
  BriefCadence,
  BriefGenerationReason,
  BriefWithItems,
  CreateBriefItemInput,
} from "@tendnote/domain";
import type {
  RelationshipAgendaCandidate,
  RelationshipAgendaInput,
  RelationshipAgendaKind,
} from "../relationship-agenda/types";
import type { BriefStore } from "./types";

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
  }
> = {
  daily: {
    windowDays: 1,
    itemCap: 3,
    agendaLimit: 8,
    includeKinds: ["due_followup", "birthday", "suggested_followup", "review_item"],
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
  // Injectable clock for deterministic tests.
  now?: Date;
};

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
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
 * Regeneration here supersedes-and-replaces; honoring prior dismiss/snooze
 * feedback during reselection (ADR-0008) arrives in issue #68 and layers on top
 * of this seam without changing the generator's contract.
 */
export function createBriefGenerator(store: BriefStore, agenda: BriefAgendaSource) {
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

      const candidates = await agenda.getRelationshipAgenda({
        ownerUserId: input.ownerUserId,
        windowStart,
        windowEnd,
        includeKinds: config.includeKinds,
        limit: config.agendaLimit,
      });

      const items = candidates
        // Restricted content is never surfaced in proactive briefs (ADR-0058).
        .filter((candidate) => candidate.sensitivity !== "restricted")
        .slice(0, config.itemCap)
        .map((candidate, index) => toBriefItem(input.ownerUserId, candidate, index + 1));

      const generationReason: BriefGenerationReason = input.regenerate
        ? "regenerated"
        : (input.generationReason ?? "scheduled");

      return store.createBrief({
        ownerUserId: input.ownerUserId,
        cadence: input.cadence,
        localDate: input.localDate,
        generationReason,
        generatedAt: now,
        windowStart,
        windowEnd,
        summary: null,
        summaryProvenance: null,
        supersededAt: null,
        items,
      });
    },
  };
}
