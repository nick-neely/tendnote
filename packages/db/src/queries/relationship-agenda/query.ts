import type {
  RelationshipAgendaCandidate,
  RelationshipAgendaInput,
  RelationshipAgendaKind,
  RelationshipAgendaStore,
} from "./types";

const DEFAULT_LIMIT = 10;
const BIRTHDAY_PREP_BUFFER_DAYS = 7;
const BROAD_AGENDA_QUERY = /\b(who deserves|deserves a thought|check in|review|relationship)\b/i;
const EXACT_DATE_QUERY =
  /\b(today|tomorrow|yesterday|this week|next week|weekend|month|specific|between|on \d{1,2}|due soon|coming up)\b/i;

function requested(input: RelationshipAgendaInput, kind: RelationshipAgendaKind) {
  return input.includeKinds === undefined || input.includeKinds.includes(kind);
}

function validWindow(input: RelationshipAgendaInput) {
  if (Number.isNaN(input.windowStart.getTime()) || Number.isNaN(input.windowEnd.getTime())) {
    throw new Error("Relationship agenda needs valid windowStart and windowEnd dates.");
  }

  if (input.windowEnd.getTime() < input.windowStart.getTime()) {
    throw new Error("Relationship agenda windowEnd must be after windowStart.");
  }
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

function dedupeSourceRefs(candidate: RelationshipAgendaCandidate) {
  const seen = new Set<string>();

  return {
    ...candidate,
    sourceRefs: candidate.sourceRefs.filter((ref) => {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }),
  };
}

function rank(candidates: Array<RelationshipAgendaCandidate & { score: number }>) {
  return candidates
    .sort((a, b) => a.score - b.score || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
    .map(({ score: _score, ...candidate }, index) =>
      dedupeSourceRefs({ ...candidate, rank: index + 1 }),
    );
}

/**
 * Shared owner-scoped relationship agenda read model foundation (PRD #51/#52).
 * This first slice ranks active follow-ups and stored birthdays; later slices add
 * review, recent, semantic, and suggested follow-up candidate sources behind the
 * same read-only contract.
 */
export function createRelationshipAgenda(store: RelationshipAgendaStore) {
  return {
    async getRelationshipAgenda(input: RelationshipAgendaInput) {
      validWindow(input);

      const candidates: Array<RelationshipAgendaCandidate & { score: number }> = [];

      if (requested(input, "due_followup")) {
        const followups = await store.listActiveFollowupsForOwner({
          ownerUserId: input.ownerUserId,
          dueBefore: input.windowEnd,
        });

        for (const followup of followups) {
          const person = await store.getPerson({
            ownerUserId: input.ownerUserId,
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
            rank: 0,
            score: overdue ? 0 : 10,
          });
        }
      }

      if (requested(input, "birthday")) {
        const birthdayWindowEnd = shouldUseBirthdayPrepBuffer(input)
          ? addDays(input.windowEnd, BIRTHDAY_PREP_BUFFER_DAYS)
          : input.windowEnd;
        const people = await store.listPeople({ ownerUserId: input.ownerUserId });

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
      }

      if (requested(input, "review_item")) {
        const [suggestedMemories, suggestedFollowups, sourceRecordReviews] = await Promise.all([
          store.listSuggestedMemoriesForOwner({
            ownerUserId: input.ownerUserId,
            limit: input.limit,
          }),
          store.listSuggestedFollowupsForOwner({
            ownerUserId: input.ownerUserId,
            limit: input.limit,
          }),
          store.listSourceRecordReviewsForOwner({
            ownerUserId: input.ownerUserId,
            limit: input.limit,
          }),
        ]);

        for (const memory of suggestedMemories.filter(
          (candidate) =>
            candidate.ownerUserId === input.ownerUserId && candidate.status === "suggested",
        )) {
          const [person, sourceRecord] = await Promise.all([
            store.getPerson({ ownerUserId: input.ownerUserId, personId: memory.personId }),
            store.getSourceRecord({
              ownerUserId: input.ownerUserId,
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
            rank: 0,
            score: 40,
          });
        }

        for (const followup of suggestedFollowups.filter(
          (candidate) =>
            candidate.ownerUserId === input.ownerUserId && candidate.status === "suggested",
        )) {
          const [person, sourceRecord] = await Promise.all([
            store.getPerson({ ownerUserId: input.ownerUserId, personId: followup.personId }),
            followup.sourceRecordId
              ? store.getSourceRecord({
                  ownerUserId: input.ownerUserId,
                  sourceRecordId: followup.sourceRecordId,
                })
              : Promise.resolve(null),
          ]);

          if (!person) {
            continue;
          }

          candidates.push({
            kind: "review_item",
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
            rank: 0,
            score: 45,
          });
        }

        for (const review of sourceRecordReviews.filter(
          (candidate) =>
            candidate.sourceRecord.ownerUserId === input.ownerUserId &&
            ["active", "pending_resolution"].includes(candidate.sourceRecord.status),
        )) {
          const primaryPerson = review.linkedPeople[0] ?? null;
          const personless = primaryPerson === null;

          candidates.push({
            kind: "review_item",
            personId: primaryPerson?.id ?? null,
            personDisplayName: primaryPerson?.displayName ?? null,
            title: personless
              ? "Resolve a personless source record"
              : `Review logged context for ${primaryPerson.displayName}`,
            reason: personless
              ? "This source record needs person resolution before it becomes relationship context."
              : review.sourceRecord.content,
            sourceRefs: [{ kind: "source_record", id: review.sourceRecord.id }],
            trustLevel: "logged_context",
            sensitivity: review.sourceRecord.sensitivity,
            rank: 0,
            score: personless ? 80 : 50,
          });
        }
      }

      return rank(candidates).slice(0, input.limit ?? DEFAULT_LIMIT);
    },
  };
}
