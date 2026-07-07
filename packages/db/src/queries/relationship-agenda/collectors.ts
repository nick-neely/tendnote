import {
  scopeForVisibilityChoice,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain/privacy";
import type {
  RelationshipAgendaCandidate,
  RelationshipAgendaInput,
  RelationshipAgendaKind,
  RelationshipAgendaSourceRef,
  RelationshipAgendaStore,
} from "./types";

const RECENT_CONTEXT_LIMIT = 3;
const SEMANTIC_CONTEXT_LIMIT = 3;
const BIRTHDAY_PREP_BUFFER_DAYS = 7;
const BROAD_AGENDA_QUERY = /\b(who deserves|deserves a thought|check in|review|relationship)\b/i;
const EXACT_DATE_QUERY =
  /\b(today|tomorrow|yesterday|this week|next week|weekend|month|specific|between|on \d{1,2}|due soon|coming up)\b/i;
const SENSITIVE_CONTEXT_QUERY =
  /\b(restricted|sensitive|private|confidential|delicate|personal|hidden|sensitivity)\b/i;

/** A candidate paired with its sort key; the score is stripped during ranking. */
export type ScoredCandidate = RelationshipAgendaCandidate & { score: number };

/** Whether the caller asked for this candidate kind (no filter means all kinds). */
export function requested(input: RelationshipAgendaInput, kind: RelationshipAgendaKind) {
  return input.includeKinds === undefined || input.includeKinds.includes(kind);
}

function shouldUseBirthdayPrepBuffer(input: RelationshipAgendaInput) {
  if (!input.query) {
    return false;
  }

  if (BROAD_AGENDA_QUERY.test(input.query)) {
    return true;
  }

  return !EXACT_DATE_QUERY.test(input.query);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function birthdayForYear(birthday: string, year: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) {
    return null;
  }

  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return null;
  }

  return candidate;
}

function nextBirthdayInRange(input: { birthday: string; from: Date; to: Date }) {
  for (let year = input.from.getUTCFullYear(); year <= input.to.getUTCFullYear() + 1; year += 1) {
    const candidate = birthdayForYear(input.birthday, year);

    if (
      candidate &&
      candidate.getTime() >= input.from.getTime() &&
      candidate.getTime() <= input.to.getTime()
    ) {
      return candidate;
    }
  }

  return null;
}

function normalizedReason(reason: string) {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Share of the smaller reason's significant tokens (>2 chars) that also appear in
 * the larger. Returns 0 when the smaller side has too few tokens to compare
 * meaningfully (<4), so a near-empty reason never counts as a match.
 */
function significantTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));
  const smaller = leftTokens.size < rightTokens.size ? leftTokens : rightTokens;
  const larger = leftTokens.size < rightTokens.size ? rightTokens : leftTokens;

  if (smaller.size < 4) {
    return 0;
  }

  let shared = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      shared += 1;
    }
  }

  return shared / smaller.size;
}

/**
 * Whether two candidate reasons say materially the same thing — equal once
 * normalized, one containing the other when both are substantial, or a high
 * token-overlap ratio. Used to fold a semantic hit into an existing candidate
 * rather than surfacing a near-duplicate.
 */
function materiallySameReason(left: string, right: string) {
  const normalizedLeft = normalizedReason(left);
  const normalizedRight = normalizedReason(right);

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return true;
  }

  return significantTokenOverlap(normalizedLeft, normalizedRight) >= 0.8;
}

function overlapsExistingCandidate(
  existing: RelationshipAgendaCandidate,
  sourceRefs: RelationshipAgendaCandidate["sourceRefs"],
  input: { personId: string | null; reason: string },
) {
  const existingRefs = new Set(existing.sourceRefs.map((ref) => `${ref.kind}:${ref.id}`));
  const hasSharedSource = sourceRefs.some((ref) => existingRefs.has(`${ref.kind}:${ref.id}`));
  const hasSamePerson =
    existing.personId !== null && input.personId !== null && existing.personId === input.personId;
  const hasMateriallySameReason = materiallySameReason(existing.reason, input.reason);

  return hasSharedSource || hasSamePerson || hasMateriallySameReason;
}

function shouldIncludeRestrictedSemanticResult(input: RelationshipAgendaInput) {
  return (
    input.directlyRequested === true &&
    Boolean(input.query && SENSITIVE_CONTEXT_QUERY.test(input.query))
  );
}

/**
 * Active follow-ups due before the window end. Overdue reminders sort ahead of
 * the rest; both are the highest-trust candidate kind (an explicit reminder).
 */
export async function collectDueFollowups(
  store: RelationshipAgendaStore,
  input: RelationshipAgendaInput,
): Promise<ScoredCandidate[]> {
  const followups = await store.listVisibleActiveFollowups({
    callerUserId: input.ownerUserId,
    dueBefore: input.windowEnd,
  });
  const candidates: ScoredCandidate[] = [];

  for (const followup of followups) {
    const person = await store.getPerson({
      ownerUserId: followup.ownerUserId,
      personId: followup.personId,
    });

    if (!person) {
      continue;
    }

    const overdue = followup.dueAt.getTime() < input.windowStart.getTime();
    candidates.push({
      kind: "due_followup",
      personId: person.id,
      personDisplayName: person.displayName,
      title: overdue
        ? `Overdue follow-up for ${person.displayName}`
        : `Follow up with ${person.displayName}`,
      reason: followup.reason,
      dueAt: followup.dueAt,
      sourceRefs: [{ kind: "followup", id: followup.id }],
      trustLevel: "active_reminder",
      sensitivity: "normal",
      visibilityChoice: visibilityChoiceForScope(followup.scope),
      visibilityLabel: visibilityLabelForScope(followup.scope),
      scope: followup.scope,
      householdId: followup.householdId,
      rank: 0,
      score: overdue ? 0 : 10,
    });
  }

  return candidates;
}

/**
 * Stored birthdays falling inside the window. Broad/undated agenda queries also
 * reach into a prep buffer past the window end so an imminent birthday surfaces
 * with time to prepare; those buffer hits score lower than in-window ones.
 */
export async function collectBirthdays(
  store: RelationshipAgendaStore,
  input: RelationshipAgendaInput,
): Promise<ScoredCandidate[]> {
  const birthdayWindowEnd = shouldUseBirthdayPrepBuffer(input)
    ? addDays(input.windowEnd, BIRTHDAY_PREP_BUFFER_DAYS)
    : input.windowEnd;
  const people = await store.listPeople({ ownerUserId: input.ownerUserId });
  const candidates: ScoredCandidate[] = [];

  for (const person of people) {
    if (!person.birthday) {
      continue;
    }

    const nextBirthday = nextBirthdayInRange({
      birthday: person.birthday,
      from: input.windowStart,
      to: birthdayWindowEnd,
    });

    if (!nextBirthday) {
      continue;
    }

    const inRequestedWindow = nextBirthday.getTime() <= input.windowEnd.getTime();
    candidates.push({
      kind: "birthday",
      personId: person.id,
      personDisplayName: person.displayName,
      title: inRequestedWindow
        ? `${person.displayName}'s birthday`
        : `Upcoming birthday for ${person.displayName}`,
      reason: inRequestedWindow
        ? "Birthday falls inside the requested window."
        : "Birthday is outside the requested window but inside the prep buffer.",
      dueAt: nextBirthday,
      sourceRefs: [{ kind: "person", id: person.id }],
      trustLevel: "stored_profile_data",
      sensitivity: "normal",
      rank: 0,
      score: inRequestedWindow ? 30 : 60,
    });
  }

  return candidates;
}

/**
 * Tentative items awaiting the owner's review: suggested memories, suggested
 * follow-ups, and source records that still need attention (including personless
 * records that block person resolution). The three backing lists are fetched in
 * parallel because all three review kinds share this entry point.
 */
export async function collectReviewCandidates(
  store: RelationshipAgendaStore,
  input: RelationshipAgendaInput,
): Promise<ScoredCandidate[]> {
  const [suggestedMemories, suggestedFollowups, sourceRecordReviews] = await Promise.all([
    store.listVisibleSuggestedMemories({ callerUserId: input.ownerUserId, limit: input.limit }),
    store.listVisibleSuggestedFollowups({ callerUserId: input.ownerUserId, limit: input.limit }),
    store.listVisibleSourceRecordReviews({ callerUserId: input.ownerUserId, limit: input.limit }),
  ]);
  const candidates: ScoredCandidate[] = [];

  if (requested(input, "review_item")) {
    candidates.push(...(await collectSuggestedMemoryReviews(store, suggestedMemories)));
  }

  if (requested(input, "suggested_followup")) {
    candidates.push(...(await collectSuggestedFollowupReviews(store, suggestedFollowups)));
  }

  if (requested(input, "review_item")) {
    candidates.push(...collectSourceRecordReviewItems(sourceRecordReviews));
  }

  return candidates;
}

/** Suggested memories still awaiting review, each resolved against its person + source. */
async function collectSuggestedMemoryReviews(
  store: RelationshipAgendaStore,
  suggestedMemories: Awaited<ReturnType<RelationshipAgendaStore["listVisibleSuggestedMemories"]>>,
): Promise<ScoredCandidate[]> {
  const candidates: ScoredCandidate[] = [];

  for (const memory of suggestedMemories.filter((candidate) => candidate.status === "suggested")) {
    const [person, sourceRecord] = await Promise.all([
      store.getPerson({ ownerUserId: memory.ownerUserId, personId: memory.personId }),
      store.getSourceRecord({
        ownerUserId: memory.ownerUserId,
        sourceRecordId: memory.sourceRecordId,
      }),
    ]);

    if (!person) {
      continue;
    }

    candidates.push({
      kind: "review_item",
      personId: person.id,
      personDisplayName: person.displayName,
      title: `Review suggested memory for ${person.displayName}`,
      reason: memory.content,
      sourceRefs: [
        { kind: "memory", id: memory.id },
        ...(sourceRecord ? [{ kind: "source_record" as const, id: sourceRecord.id }] : []),
      ],
      trustLevel: "tentative",
      sensitivity: memory.sensitivity,
      visibilityChoice: visibilityChoiceForScope(memory.scope),
      visibilityLabel: visibilityLabelForScope(memory.scope),
      scope: memory.scope,
      householdId: memory.householdId ?? null,
      rank: 0,
      score: 40,
    });
  }

  return candidates;
}

/** Suggested follow-ups still awaiting review, each resolved against its person + source. */
async function collectSuggestedFollowupReviews(
  store: RelationshipAgendaStore,
  suggestedFollowups: Awaited<ReturnType<RelationshipAgendaStore["listVisibleSuggestedFollowups"]>>,
): Promise<ScoredCandidate[]> {
  const candidates: ScoredCandidate[] = [];

  for (const followup of suggestedFollowups.filter(
    (candidate) => candidate.status === "suggested",
  )) {
    const [person, sourceRecord] = await Promise.all([
      store.getPerson({ ownerUserId: followup.ownerUserId, personId: followup.personId }),
      followup.sourceRecordId
        ? store.getSourceRecord({
            ownerUserId: followup.ownerUserId,
            sourceRecordId: followup.sourceRecordId,
          })
        : Promise.resolve(null),
    ]);

    if (!person) {
      continue;
    }

    candidates.push({
      kind: "suggested_followup",
      personId: person.id,
      personDisplayName: person.displayName,
      title: `Review suggested follow-up for ${person.displayName}`,
      reason: followup.reason,
      dueAt: followup.dueAt,
      sourceRefs: [
        { kind: "followup", id: followup.id },
        ...(sourceRecord ? [{ kind: "source_record" as const, id: sourceRecord.id }] : []),
      ],
      trustLevel: "tentative",
      sensitivity: sourceRecord?.sensitivity ?? "normal",
      visibilityChoice: visibilityChoiceForScope(followup.scope),
      visibilityLabel: visibilityLabelForScope(followup.scope),
      scope: followup.scope,
      householdId: followup.householdId,
      rank: 0,
      score: 45,
    });
  }

  return candidates;
}

/** Source records still needing attention (including personless records blocking resolution). */
function collectSourceRecordReviewItems(
  sourceRecordReviews: Awaited<
    ReturnType<RelationshipAgendaStore["listVisibleSourceRecordReviews"]>
  >,
): ScoredCandidate[] {
  return sourceRecordReviews
    .filter((candidate) => ["active", "pending_resolution"].includes(candidate.sourceRecord.status))
    .map(sourceRecordReviewCandidate);
}

/** Build the review candidate for one source record, handling the personless case. */
function sourceRecordReviewCandidate(
  review: Awaited<ReturnType<RelationshipAgendaStore["listVisibleSourceRecordReviews"]>>[number],
): ScoredCandidate {
  const { sourceRecord } = review;
  const shared = {
    kind: "review_item" as const,
    sourceRefs: [{ kind: "source_record" as const, id: sourceRecord.id }],
    trustLevel: "logged_context" as const,
    sensitivity: sourceRecord.sensitivity,
    visibilityChoice: visibilityChoiceForScope(sourceRecord.scope),
    visibilityLabel: visibilityLabelForScope(sourceRecord.scope),
    scope: sourceRecord.scope,
    householdId: sourceRecord.householdId ?? null,
    rank: 0,
  };

  const primaryPerson = review.linkedPeople[0] ?? null;

  if (primaryPerson === null) {
    return {
      ...shared,
      personId: null,
      personDisplayName: null,
      title: "Resolve a personless source record",
      reason: "This source record needs person resolution before it becomes relationship context.",
      score: 80,
    };
  }

  return {
    ...shared,
    personId: primaryPerson.id,
    personDisplayName: primaryPerson.displayName,
    title: `Review logged context for ${primaryPerson.displayName}`,
    reason: sourceRecord.content,
    score: 50,
  };
}

/**
 * The most recent active, person-linked logged context. Restricted records stay
 * out (this is a proactive surface, ADR 0058); the newest few give "what's been
 * going on lately" without the owner asking.
 */
export async function collectRecentContext(
  store: RelationshipAgendaStore,
  input: RelationshipAgendaInput,
): Promise<ScoredCandidate[]> {
  const recentSourceRecords = await store.listVisibleRecentSourceRecords({
    callerUserId: input.ownerUserId,
    limit: RECENT_CONTEXT_LIMIT,
  });
  const candidates: ScoredCandidate[] = [];

  for (const recent of recentSourceRecords.filter(
    (candidate) =>
      candidate.sourceRecord.status === "active" &&
      candidate.sourceRecord.sensitivity !== "restricted" &&
      !Number.isNaN(candidate.sourceRecord.createdAt.getTime()) &&
      candidate.linkedPeople.length > 0,
  )) {
    const primaryPerson = recent.linkedPeople[0];

    if (!primaryPerson) {
      continue;
    }

    candidates.push({
      kind: "recent_context",
      personId: primaryPerson.id,
      personDisplayName: primaryPerson.displayName,
      title: `Recent logged context for ${primaryPerson.displayName}`,
      reason: recent.sourceRecord.content,
      dueAt: recent.sourceRecord.createdAt,
      sourceRefs: [{ kind: "source_record", id: recent.sourceRecord.id }],
      trustLevel: "logged_context",
      sensitivity: recent.sourceRecord.sensitivity,
      visibilityChoice: visibilityChoiceForScope(recent.sourceRecord.scope),
      visibilityLabel: visibilityLabelForScope(recent.sourceRecord.scope),
      scope: recent.sourceRecord.scope,
      householdId: recent.sourceRecord.householdId ?? null,
      rank: 0,
      score: 90,
    });
  }

  return candidates;
}

/**
 * Query-driven semantic matches, merged into the candidates already collected.
 * A semantic hit that overlaps an existing candidate (shared source, same
 * person, or materially the same reason) folds its source refs into that
 * candidate instead of adding a near-duplicate row; only genuinely new context
 * is appended. Restricted matches require an explicit, sensitive request, and a
 * failed search degrades to no results rather than failing the agenda.
 */
type SemanticContextResult = Awaited<
  ReturnType<RelationshipAgendaStore["searchSemanticContext"]>
>[number];

/** The display title for a semantic-context candidate, guarding restricted wording and a missing name. */
function semanticContextTitle(result: SemanticContextResult): string {
  if (result.sensitivity === "restricted") {
    return result.relatedPersonDisplayName
      ? `Restricted related context for ${result.relatedPersonDisplayName}`
      : "Restricted related relationship context";
  }
  return result.relatedPersonDisplayName
    ? `Related context for ${result.relatedPersonDisplayName}`
    : "Related relationship context";
}

/**
 * Fold one semantic result into the candidate set: merge it into an overlapping candidate
 * (unioning source refs and filling any missing visibility), or add it as a fresh
 * semantic-context candidate.
 */
function mergeSemanticResult(candidates: ScoredCandidate[], result: SemanticContextResult): void {
  // General Actions are not relationship-agenda context (ADRs 0143, 0155): the agenda
  // scopes its semantic call to memory/source_record, so an `action_item` result never
  // occurs — this guard keeps that invariant explicit and narrows the trust level.
  if (result.trustLevel === "action_item") {
    return;
  }
  const sourceRefs: RelationshipAgendaSourceRef[] = result.sourceRefs.map((ref) => ({
    kind: ref.kind === "memory" ? "memory" : "source_record",
    id: ref.id,
  }));
  const overlap = candidates.find((candidate) =>
    overlapsExistingCandidate(candidate, sourceRefs, {
      personId: result.relatedPersonId,
      reason: result.snippet,
    }),
  );

  if (overlap) {
    overlap.sourceRefs.push(...sourceRefs);
    overlap.visibilityChoice ??= result.visibilityChoice;
    overlap.visibilityLabel ??= result.visibilityLabel;
    return;
  }

  candidates.push({
    kind: "semantic_context",
    personId: result.relatedPersonId,
    personDisplayName: result.relatedPersonDisplayName,
    title: semanticContextTitle(result),
    reason: result.snippet,
    sourceRefs,
    trustLevel: result.trustLevel,
    sensitivity: result.sensitivity,
    visibilityChoice: result.visibilityChoice,
    visibilityLabel: result.visibilityLabel,
    // Semantic hits carry a visibility choice but not the backing household id, so
    // a `household` semantic result fails closed (household scope with a null id)
    // rather than being treated as household-safe for delivery aggregation.
    scope: scopeForVisibilityChoice(result.visibilityChoice),
    householdId: null,
    rank: 0,
    score: 70,
  });
}

export async function mergeSemanticContext(
  store: RelationshipAgendaStore,
  input: RelationshipAgendaInput,
  candidates: ScoredCandidate[],
): Promise<void> {
  if (!input.query) {
    return;
  }

  let semanticResults: Awaited<ReturnType<RelationshipAgendaStore["searchSemanticContext"]>>;
  try {
    semanticResults = await store.searchSemanticContext({
      ownerUserId: input.ownerUserId,
      query: input.query,
      limit: SEMANTIC_CONTEXT_LIMIT,
      directlyRequested: input.directlyRequested ?? false,
    });
  } catch {
    semanticResults = [];
  }

  for (const result of semanticResults.filter(
    (candidate) =>
      candidate.sensitivity !== "restricted" || shouldIncludeRestrictedSemanticResult(input),
  )) {
    mergeSemanticResult(candidates, result);
  }
}
