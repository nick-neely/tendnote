import type { TodayCandidate } from "@tendnote/domain";
import type { RelationshipAgendaCandidate } from "../../relationship-agenda";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { DAY_MS, dateOnlyKey, formatDateInZone, formatDateOnly } from "./shared";

const BIRTHDAY_PREP_DAYS = 14;
const RESURFACE_AGE_DAYS = 30;

export async function loadRelationshipCandidates(
  deps: TodayCandidateLoaderDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const start = new Date(`${input.localDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAY_MS);
  const [today, birthdays] = await Promise.all([
    deps.loadRelationshipAgenda({
      ownerUserId: input.ownerUserId,
      windowStart: start,
      windowEnd: end,
      limit: 24,
      includeKinds: ["due_followup", "review_item", "suggested_followup", "recent_context"],
    }),
    deps.loadRelationshipAgenda({
      ownerUserId: input.ownerUserId,
      windowStart: start,
      windowEnd: new Date(end.getTime() + BIRTHDAY_PREP_DAYS * DAY_MS),
      limit: 12,
      includeKinds: ["birthday"],
    }),
  ]);
  return [...today, ...birthdays]
    .map((candidate) =>
      relationshipCandidate(candidate, input.now, input.localDate, input.timeZone),
    )
    .filter((candidate): candidate is TodayCandidate => candidate !== null);
}

function relationshipCandidate(
  candidate: RelationshipAgendaCandidate,
  now: Date,
  localDate: string,
  timeZone: string,
): TodayCandidate | null {
  if (candidate.sensitivity === "restricted") return null;
  if (candidate.kind === "due_followup") return dueFollowupCandidate(candidate, localDate);
  if (candidate.kind === "birthday") return birthdayCandidate(candidate);
  if (candidate.kind === "recent_context") return recentContextCandidate(candidate, now, timeZone);
  return reviewCandidate(candidate);
}

function dueFollowupCandidate(
  candidate: RelationshipAgendaCandidate,
  localDate: string,
): TodayCandidate | null {
  const dueAt = candidate.dueAt;
  const personId = candidate.personId;
  const followup = candidate.sourceRefs.find((ref) => ref.kind === "followup");
  if (!followup || !personId || !dueAt) return null;
  const past = dateOnlyKey(dueAt) < localDate;
  return baseCandidate(candidate, {
    identity: `follow_up:${followup.id}`,
    family: "follow_up",
    record: {
      kind: "follow_up",
      id: followup.id,
      href: `/people/${personId}#followup-${followup.id}`,
    },
    reason: {
      // `code` is the machine key Today ranks and suppresses on; the explanation is
      // the sentence the owner reads, and it never says "overdue" (DESIGN.md §9).
      code: past ? "overdue" : "due_today",
      key: `due:${dueAt.toISOString()}`,
      explanation: past ? `Waiting since ${formatDateOnly(dueAt)}.` : "Due today.",
    },
    action: { kind: "complete_follow_up", label: "Complete" },
    mandatory: true,
  });
}

function birthdayCandidate(candidate: RelationshipAgendaCandidate): TodayCandidate | null {
  const dueAt = candidate.dueAt;
  const personId = candidate.personId;
  if (!personId || !dueAt) return null;
  return baseCandidate(candidate, {
    identity: `birthday:${personId}`,
    family: "birthday",
    record: { kind: "person", id: personId, href: `/people/${personId}` },
    reason: {
      code: "birthday_window",
      key: `birthday:${dueAt.toISOString()}`,
      explanation: `Birthday on ${formatDateOnly(dueAt)}.`,
    },
    action: { kind: "open_record", label: "Open person", href: `/people/${personId}` },
    mandatory: false,
  });
}

function recentContextCandidate(
  candidate: RelationshipAgendaCandidate,
  now: Date,
  timeZone: string,
): TodayCandidate | null {
  const dueAt = candidate.dueAt;
  const personId = candidate.personId;
  const source = candidate.sourceRefs[0];
  if (
    !source ||
    !personId ||
    !dueAt ||
    now.getTime() - dueAt.getTime() < RESURFACE_AGE_DAYS * DAY_MS
  ) {
    return null;
  }
  return baseCandidate(candidate, {
    identity: `relationship_context:${personId}:${source.kind}:${source.id}`,
    family: "relationship_context",
    record: { kind: "person", id: personId, href: `/people/${personId}` },
    reason: {
      code: "relationship_resurfacing",
      key: `stale:${source.kind}:${source.id}:${dueAt.toISOString()}`,
      explanation: `Grounded context last recorded ${formatDateInZone(dueAt, timeZone)}.`,
    },
    action: { kind: "open_record", label: "Open person", href: `/people/${personId}` },
    mandatory: false,
  });
}

function reviewCandidate(candidate: RelationshipAgendaCandidate): TodayCandidate | null {
  const source = candidate.sourceRefs[0];
  if (!source) return null;
  const personId = candidate.personId;
  const recordId = source.id;
  const href =
    source.kind === "memory" && personId
      ? `/people/${personId}#memory-${source.id}`
      : source.kind === "followup" && personId
        ? `/people/${personId}#followup-${source.id}`
        : "/?tab=review";
  const recordKind =
    source.kind === "memory"
      ? ("memory" as const)
      : source.kind === "followup"
        ? ("follow_up" as const)
        : ("review_item" as const);
  return baseCandidate(candidate, {
    identity: `review:${candidate.kind}:${recordId}`,
    family: "review",
    record: { kind: recordKind, id: recordId, href },
    reason: {
      code: "awaiting_review",
      key: `review:${candidate.kind}:${recordId}`,
      explanation: "Waiting for your review.",
    },
    action: { kind: "open_review", label: "Review", href: "/?tab=review" },
    mandatory: false,
  });
}

function baseCandidate(
  candidate: RelationshipAgendaCandidate,
  values: Pick<
    TodayCandidate,
    "identity" | "family" | "record" | "reason" | "action" | "mandatory"
  >,
): TodayCandidate {
  return {
    ...values,
    title: candidate.title,
    context: candidate.personDisplayName ?? candidate.reason,
    sourceRefs: candidate.sourceRefs,
    dueAt: candidate.dueAt ?? null,
    createdAt: candidate.dueAt ?? new Date(0),
    sensitivity: candidate.sensitivity,
  };
}
