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

      return rank(candidates).slice(0, input.limit ?? DEFAULT_LIMIT);
    },
  };
}
