import { z } from "zod";
import { sensitivitySchema } from "./privacy";

export const todayFamilySchema = z.enum([
  "follow_up",
  "birthday",
  "action",
  "routine",
  "calendar",
  "review",
  "saved_item",
  "relationship_context",
]);
export type TodayFamily = z.infer<typeof todayFamilySchema>;

export const todayRecordKindSchema = z.enum([
  "follow_up",
  "person",
  "general_action",
  "calendar_event",
  "review_item",
  "saved_item",
  "memory",
]);

export const todayReasonCodeSchema = z.enum([
  "overdue",
  "due_today",
  "birthday_window",
  "calendar_today",
  "awaiting_review",
  "bring_back_arrived",
  "resurfaced",
  "aged_after_cooldown",
  "relationship_resurfacing",
]);
export type TodayReasonCode = z.infer<typeof todayReasonCodeSchema>;

export const todayActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete_follow_up"), label: z.string().min(1) }),
  z.object({ kind: z.literal("complete_action"), label: z.string().min(1) }),
  z.object({
    kind: z.literal("open_review"),
    label: z.string().min(1),
    href: z.string().optional(),
  }),
  z.object({
    kind: z.literal("view_calendar"),
    label: z.string().min(1),
    href: z.string().optional(),
  }),
  z.object({
    kind: z.literal("open_record"),
    label: z.string().min(1),
    href: z.string().optional(),
  }),
]);

export const todayCandidateSchema = z.object({
  identity: z.string().min(1),
  family: todayFamilySchema,
  record: z.object({
    kind: todayRecordKindSchema,
    id: z.string().min(1),
    href: z.string().min(1),
  }),
  title: z.string().min(1),
  context: z.string().min(1),
  reason: z.object({
    code: todayReasonCodeSchema,
    key: z.string().min(1),
    explanation: z.string().min(1),
  }),
  sourceRefs: z.array(z.object({ kind: z.string().min(1), id: z.string().min(1) })).min(1),
  action: todayActionSchema,
  mandatory: z.boolean(),
  dueAt: z.date().nullable().optional(),
  createdAt: z.date(),
  sensitivity: sensitivitySchema,
});
export type TodayCandidate = z.infer<typeof todayCandidateSchema>;

export const todayFeedbackSchema = z.object({
  ownerUserId: z.string().min(1),
  candidateIdentity: z.string().min(1),
  reasonKey: z.string().min(1),
  kind: z.enum(["later", "not_today"]),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  suppressUntil: z.date().nullable(),
});
export type TodayFeedback = z.infer<typeof todayFeedbackSchema>;

export const todayRankingOutputSchema = z.object({
  orderedIdentities: z.array(z.string().min(1)).max(24),
});
export type TodayRankingOutput = z.infer<typeof todayRankingOutputSchema>;

export type TodayCurationResult = {
  items: TodayCandidate[];
  optionalCandidates: TodayCandidate[];
  candidateFingerprint: string;
  overflow: {
    mandatoryCount: number;
    omittedCount: number;
    destinations: Array<{ family: TodayFamily; label: string; href: string }>;
  } | null;
};

export const todayShortlistResponseSchema = z.object({
  items: z.array(todayCandidateSchema).max(5),
  candidateFingerprint: z.string(),
  curation: z.enum(["eve_ranked", "deterministic", "deterministic_fallback"]),
  overflow: z
    .object({
      mandatoryCount: z.number().int().nonnegative(),
      omittedCount: z.number().int().positive(),
      destinations: z.array(
        z.object({ family: todayFamilySchema, label: z.string().min(1), href: z.string().min(1) }),
      ),
    })
    .nullable(),
  limitations: z.array(z.string()),
});
export type TodayShortlistResponse = z.infer<typeof todayShortlistResponseSchema>;

const TODAY_MAX_ITEMS = 5;
const TODAY_TARGET_ITEMS = 3;
const TODAY_OPTIONAL_FAMILY_LIMIT = 4;
const TODAY_OPTIONAL_POOL_LIMIT = 24;

function compareMandatory(a: TodayCandidate, b: TodayCandidate): number {
  const aDue = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return aDue - bDue || a.identity.localeCompare(b.identity);
}

export function curateTodayCandidates(input: {
  candidates: TodayCandidate[];
  feedback?: TodayFeedback[];
  localDate?: string;
  now: Date;
  optionalOrder?: string[];
}): TodayCurationResult {
  const suppressed = activeFeedbackKeys(input);
  const candidates = deduplicateCandidates(
    input.candidates
      .map((candidate) => todayCandidateSchema.parse(candidate))
      .filter(
        (candidate) =>
          candidate.sensitivity !== "restricted" &&
          !suppressed.has(`${candidate.identity}|${candidate.reason.key}`),
      ),
  );
  const mandatory = candidates.filter((candidate) => candidate.mandatory).sort(compareMandatory);

  if (mandatory.length >= TODAY_MAX_ITEMS) {
    const omitted = mandatory.slice(TODAY_MAX_ITEMS);
    return {
      items: mandatory.slice(0, TODAY_MAX_ITEMS),
      optionalCandidates: [],
      candidateFingerprint: fingerprintCandidates(candidates),
      overflow:
        mandatory.length > TODAY_MAX_ITEMS
          ? {
              mandatoryCount: mandatory.length,
              omittedCount: omitted.length,
              destinations: overflowDestinations(omitted),
            }
          : null,
    };
  }

  const optionalCandidates = boundedOptionalCandidates(candidates);
  const orderedOptional = orderOptionalCandidates(optionalCandidates, input.optionalOrder ?? []);
  const target = Math.min(TODAY_TARGET_ITEMS, TODAY_MAX_ITEMS);

  return {
    items: [...mandatory, ...orderedOptional.slice(0, Math.max(0, target - mandatory.length))],
    optionalCandidates,
    candidateFingerprint: fingerprintCandidates(candidates),
    overflow: null,
  };
}

function fingerprintCandidates(candidates: TodayCandidate[]): string {
  return candidates
    .map((candidate) =>
      JSON.stringify({
        identity: candidate.identity,
        family: candidate.family,
        record: candidate.record,
        title: candidate.title,
        context: candidate.context,
        reason: candidate.reason,
        sourceRefs: candidate.sourceRefs,
        action: candidate.action,
        mandatory: candidate.mandatory,
        dueAt: candidate.dueAt?.toISOString() ?? null,
        createdAt: candidate.createdAt.toISOString(),
        sensitivity: candidate.sensitivity,
      }),
    )
    .sort()
    .join("|");
}

function activeFeedbackKeys(input: {
  feedback?: TodayFeedback[];
  localDate?: string;
  now: Date;
}): Set<string> {
  return new Set(
    (input.feedback ?? [])
      .map((feedback) => todayFeedbackSchema.parse(feedback))
      .filter(
        (feedback) =>
          (feedback.kind === "not_today" && feedback.localDate === input.localDate) ||
          (feedback.kind === "later" &&
            feedback.suppressUntil !== null &&
            feedback.suppressUntil.getTime() > input.now.getTime()),
      )
      .map((feedback) => `${feedback.candidateIdentity}|${feedback.reasonKey}`),
  );
}

function deduplicateCandidates(candidates: TodayCandidate[]): TodayCandidate[] {
  const candidatesByIdentity = new Map<string, TodayCandidate>();
  for (const candidate of candidates) {
    const existing = candidatesByIdentity.get(candidate.identity);
    if (!existing || candidate.mandatory) candidatesByIdentity.set(candidate.identity, candidate);
  }
  return [...candidatesByIdentity.values()];
}

function boundedOptionalCandidates(candidates: TodayCandidate[]): TodayCandidate[] {
  const familyCounts = new Map<TodayFamily, number>();
  return candidates
    .filter((candidate) => !candidate.mandatory)
    .sort(
      (a, b) =>
        optionalFallbackPriority(a.reason.code) - optionalFallbackPriority(b.reason.code) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.identity.localeCompare(b.identity),
    )
    .filter((candidate) => {
      const count = familyCounts.get(candidate.family) ?? 0;
      if (count >= TODAY_OPTIONAL_FAMILY_LIMIT) return false;
      familyCounts.set(candidate.family, count + 1);
      return true;
    })
    .slice(0, TODAY_OPTIONAL_POOL_LIMIT);
}

function orderOptionalCandidates(
  optionalCandidates: TodayCandidate[],
  requestedOrder: string[],
): TodayCandidate[] {
  const optionalByIdentity = new Map(
    optionalCandidates.map((candidate) => [candidate.identity, candidate]),
  );
  const deterministicOptionalOrder = balanceOptionalFamilies(optionalCandidates);
  const orderedOptional: TodayCandidate[] = [];
  for (const identity of requestedOrder) {
    const candidate = optionalByIdentity.get(identity);
    if (!candidate || orderedOptional.includes(candidate)) continue;
    orderedOptional.push(candidate);
  }
  for (const candidate of deterministicOptionalOrder) {
    if (!orderedOptional.includes(candidate)) orderedOptional.push(candidate);
  }
  return orderedOptional;
}

function overflowDestinations(
  candidates: TodayCandidate[],
): Array<{ family: TodayFamily; label: string; href: string }> {
  const destinations = new Map<TodayFamily, { family: TodayFamily; label: string; href: string }>();
  for (const candidate of candidates) {
    if (destinations.has(candidate.family)) continue;
    const destination = todayFamilyDestination(candidate.family);
    destinations.set(candidate.family, { family: candidate.family, ...destination });
  }
  return [...destinations.values()];
}

function todayFamilyDestination(family: TodayFamily): { label: string; href: string } {
  switch (family) {
    case "follow_up":
    case "birthday":
    case "relationship_context":
      return { label: "People", href: "/people" };
    case "action":
    case "routine":
      return { label: "Actions", href: "/actions" };
    case "calendar":
      return { label: "Calendar", href: "/account?tab=integrations" };
    case "review":
      return { label: "Review", href: "/?tab=review" };
    case "saved_item":
      return { label: "Saved Items", href: "/saved-items" };
  }
}

function optionalFallbackPriority(reason: TodayReasonCode): number {
  if (reason === "bring_back_arrived" || reason === "resurfaced") return 0;
  return 1;
}

function balanceOptionalFamilies(candidates: TodayCandidate[]): TodayCandidate[] {
  const byFamily = new Map<TodayFamily, TodayCandidate[]>();
  for (const candidate of candidates) {
    const family = byFamily.get(candidate.family) ?? [];
    family.push(candidate);
    byFamily.set(candidate.family, family);
  }
  const balanced: TodayCandidate[] = [];
  for (let index = 0; balanced.length < candidates.length; index += 1) {
    for (const family of byFamily.values()) {
      const candidate = family[index];
      if (candidate) balanced.push(candidate);
    }
  }
  return balanced;
}
