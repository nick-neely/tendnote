"use server";

import {
  addGiftIdea,
  claimGiftIdea,
  createGiftPlan,
  deleteGiftPlan,
  editGiftIdea,
  editGiftPlan,
  releaseGiftIdea,
  removeGiftIdea,
  searchGiftPlans,
  setGiftPlanAudience,
  setGiftPlanStatus,
  setGiftPlanSurpriseSubject,
} from "@tendnote/db/queries/gift-plans";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { GiftPlanValidationError, giftPlanStatusSchema } from "@tendnote/domain";
import { scopeForVisibilityChoice, visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  type GiftIdeaMutationResult,
  type GiftPlanMutationResult,
  type GiftPlanPeopleLabels,
  toGiftIdeaView,
  toGiftPlanView,
} from "@/lib/gift-plan-view";
import { type OwnerActionResult, runOwnerAction } from "@/lib/owner-action";

const giftPlanIdSchema = z.object({ giftPlanId: z.uuid() });
const giftIdeaIdSchema = z.object({ giftIdeaId: z.uuid() });
const selectedUserIdsSchema = z.array(z.string().min(1)).max(50).optional();

const createSchema = z.object({
  subjectName: z.string().trim().min(1, "Who is this plan for?").max(120),
  occasion: z.string().trim().min(1, "What's the occasion?").max(120),
  occasionOn: z.string().trim().optional(),
  subjectPersonId: z.uuid().optional(),
  surpriseSubjectUserId: z.string().min(1).optional(),
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: selectedUserIdsSchema,
});

const editSchema = z.object({
  giftPlanId: z.uuid(),
  subjectName: z.string().trim().min(1).max(120).optional(),
  occasion: z.string().trim().min(1).max(120).optional(),
  occasionOn: z.string().trim().nullable().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const audienceSchema = z.object({
  giftPlanId: z.uuid(),
  visibilityChoice: visibilityChoiceSchema,
  selectedUserIds: selectedUserIdsSchema,
});

const surpriseSchema = z.object({
  giftPlanId: z.uuid(),
  surpriseSubjectUserId: z.string().min(1).nullable(),
});

const statusSchema = z.object({ giftPlanId: z.uuid(), status: giftPlanStatusSchema });

const addIdeaSchema = z.object({
  giftPlanId: z.uuid(),
  title: z.string().trim().min(1, "Give the idea a short name.").max(200),
  note: z.string().trim().max(4_000).optional(),
  url: z.string().trim().max(2_000).optional(),
});

const editIdeaSchema = z.object({
  giftIdeaId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(4_000).nullable().optional(),
  url: z.string().trim().max(2_000).nullable().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const searchSchema = z.object({ query: z.string().trim().max(200) });

function parseOccasionDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new GiftPlanValidationError("Choose a valid date for the occasion.");
  }
  return parsed;
}

/**
 * The caller's own household roster, used only to turn ids into names.
 *
 * It never decides anything. Who may see a plan is settled inside the seam
 * against memberships and shares read there; this is a label lookup, and a name
 * it cannot find degrades to a neutral word rather than an id.
 */
/**
 * Turns a conflict's actor id into the name the surface will render.
 *
 * `runOwnerAction` is generic and cannot know a household roster, so it passes
 * the raw id through; resolving it here — where the roster is already loaded for
 * the view — is what lets a losing claimant read "Sam already said they'd handle
 * this" instead of a user id. An id with no name degrades to the same neutral
 * phrase the rest of the surface uses.
 */
function withNamedConflictActor<TView>(
  result: OwnerActionResult<TView>,
  people: GiftPlanPeopleLabels,
): OwnerActionResult<TView> {
  if (result.ok || !result.conflict?.actorLabel) return result;
  const actorUserId = result.conflict.actorLabel;
  return {
    ...result,
    conflict: {
      ...result.conflict,
      actorLabel: actorUserId === people.callerUserId ? "You" : people.nameFor(actorUserId),
    },
  };
}

async function peopleLabels(callerUserId: string): Promise<GiftPlanPeopleLabels> {
  const members = await listShareableHouseholdMembersForUser({ userId: callerUserId });
  const names = new Map(members.map((member) => [member.userId, member.name || member.email]));
  return {
    callerUserId,
    nameFor: (userId) => names.get(userId) ?? "Someone in your household",
  };
}

export async function createGiftPlanAction(input: {
  subjectName: string;
  occasion: string;
  occasionOn?: string;
  subjectPersonId?: string;
  surpriseSubjectUserId?: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<GiftPlanMutationResult> {
  return runOwnerAction({
    schema: createSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) =>
      createGiftPlan({
        ownerUserId,
        subjectName: parsed.subjectName,
        occasion: parsed.occasion,
        occasionOn: parseOccasionDate(parsed.occasionOn) ?? null,
        subjectPersonId: parsed.subjectPersonId ?? null,
        surpriseSubjectUserId: parsed.surpriseSubjectUserId ?? null,
        scope: resolvedScope?.scope,
        householdId: resolvedScope?.householdId,
        selectedUserIds: parsed.selectedUserIds,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftPlanView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

export async function editGiftPlanAction(input: {
  giftPlanId: string;
  subjectName?: string;
  occasion?: string;
  occasionOn?: string | null;
  expectedRevision?: number;
}): Promise<GiftPlanMutationResult> {
  const callerUserId = await requireAdmittedOwnerForAction();
  const result = await runOwnerAction({
    schema: editSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editGiftPlan({
        actorUserId: ownerUserId,
        giftPlanId: parsed.giftPlanId,
        edit: {
          ...(parsed.subjectName !== undefined ? { subjectName: parsed.subjectName } : {}),
          ...(parsed.occasion !== undefined ? { occasion: parsed.occasion } : {}),
          ...(parsed.occasionOn !== undefined
            ? { occasionOn: parseOccasionDate(parsed.occasionOn) ?? null }
            : {}),
        },
        expectedRevision: parsed.expectedRevision,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftPlanView(outcome.result, await peopleLabels(ownerUserId)),
  });
  return result.ok ? result : withNamedConflictActor(result, await peopleLabels(callerUserId));
}

export async function setGiftPlanAudienceAction(input: {
  giftPlanId: string;
  visibilityChoice: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<GiftPlanMutationResult> {
  return runOwnerAction({
    schema: audienceSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) =>
      setGiftPlanAudience({
        actorUserId: ownerUserId,
        giftPlanId: parsed.giftPlanId,
        scope: resolvedScope?.scope ?? scopeForVisibilityChoice(parsed.visibilityChoice),
        householdId: resolvedScope?.householdId,
        selectedUserIds: parsed.selectedUserIds,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftPlanView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

export async function setGiftPlanSurpriseSubjectAction(input: {
  giftPlanId: string;
  surpriseSubjectUserId: string | null;
}): Promise<GiftPlanMutationResult> {
  return runOwnerAction({
    schema: surpriseSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setGiftPlanSurpriseSubject({
        actorUserId: ownerUserId,
        giftPlanId: parsed.giftPlanId,
        surpriseSubjectUserId: parsed.surpriseSubjectUserId,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftPlanView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

export async function setGiftPlanStatusAction(input: {
  giftPlanId: string;
  status: z.infer<typeof giftPlanStatusSchema>;
}): Promise<GiftPlanMutationResult> {
  return runOwnerAction({
    schema: statusSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setGiftPlanStatus({
        actorUserId: ownerUserId,
        giftPlanId: parsed.giftPlanId,
        status: parsed.status,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftPlanView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

/**
 * Permanent deletion, deliberately with no control on any surface yet.
 *
 * The seam owes the domain a way to end a plan for good (the spec's "permanently
 * deleting it"), and this is it. What the *surface* offers is Archive, which is
 * reversible and covers every case a person actually reaches for. An irreversible
 * button that silently destroys other people's contributions needs a confirmation
 * flow of the kind Asset removal has — typed confirmation over a real summary of
 * what is about to go — and that is worth building properly rather than bolting
 * on. Until then the capability exists and nothing invokes it.
 */
export async function deleteGiftPlanAction(input: { giftPlanId: string }) {
  return runOwnerAction({
    schema: giftPlanIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      deleteGiftPlan({ actorUserId: ownerUserId, giftPlanId: parsed.giftPlanId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function addGiftIdeaAction(input: {
  giftPlanId: string;
  title: string;
  note?: string;
  url?: string;
}): Promise<GiftIdeaMutationResult> {
  return runOwnerAction({
    schema: addIdeaSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      addGiftIdea({
        actorUserId: ownerUserId,
        giftPlanId: parsed.giftPlanId,
        title: parsed.title,
        note: parsed.note || null,
        url: parsed.url || null,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftIdeaView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

export async function editGiftIdeaAction(input: {
  giftIdeaId: string;
  title?: string;
  note?: string | null;
  url?: string | null;
  expectedRevision?: number;
}): Promise<GiftIdeaMutationResult> {
  const callerUserId = await requireAdmittedOwnerForAction();
  const result = await runOwnerAction({
    schema: editIdeaSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editGiftIdea({
        actorUserId: ownerUserId,
        giftIdeaId: parsed.giftIdeaId,
        edit: {
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.note !== undefined ? { note: parsed.note || null } : {}),
          ...(parsed.url !== undefined ? { url: parsed.url || null } : {}),
        },
        expectedRevision: parsed.expectedRevision,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftIdeaView(outcome.result, await peopleLabels(ownerUserId)),
  });
  return result.ok ? result : withNamedConflictActor(result, await peopleLabels(callerUserId));
}

export async function removeGiftIdeaAction(input: { giftIdeaId: string }) {
  return runOwnerAction({
    schema: giftIdeaIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      removeGiftIdea({ actorUserId: ownerUserId, giftIdeaId: parsed.giftIdeaId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

/**
 * A lost claim race is the one failure whose payload the surface acts on: it
 * names the winner, so the row can correct itself in place rather than leaving a
 * stale "I'll handle this" button over an idea somebody else now holds.
 */
export async function claimGiftIdeaAction(input: {
  giftIdeaId: string;
}): Promise<GiftIdeaMutationResult> {
  const callerUserId = await requireAdmittedOwnerForAction();
  const result = await runOwnerAction({
    schema: giftIdeaIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      claimGiftIdea({ actorUserId: ownerUserId, giftIdeaId: parsed.giftIdeaId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftIdeaView(outcome.result, await peopleLabels(ownerUserId)),
  });
  return result.ok ? result : withNamedConflictActor(result, await peopleLabels(callerUserId));
}

export async function releaseGiftIdeaAction(input: {
  giftIdeaId: string;
}): Promise<GiftIdeaMutationResult> {
  return runOwnerAction({
    schema: giftIdeaIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      releaseGiftIdea({ actorUserId: ownerUserId, giftIdeaId: parsed.giftIdeaId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: async (outcome, ownerUserId) =>
      toGiftIdeaView(outcome.result, await peopleLabels(ownerUserId)),
  });
}

/**
 * Search across the plans the caller may see.
 *
 * It goes through the same seam as the list, so Search cannot come to a
 * different answer about who may see a plan than the page it links to. A
 * Surprise Subject searching for their own surprise gets an empty array —
 * indistinguishable from a search that matched nothing.
 */
export async function searchGiftPlansAction(input: { query: string }) {
  const callerUserId = await requireAdmittedOwnerForAction();
  const parsed = searchSchema.parse(input);
  const [plans, people] = await Promise.all([
    searchGiftPlans({ callerUserId, query: parsed.query }),
    peopleLabels(callerUserId),
  ]);
  const now = new Date();
  return plans.map((plan) => toGiftPlanView(plan, people, now));
}
