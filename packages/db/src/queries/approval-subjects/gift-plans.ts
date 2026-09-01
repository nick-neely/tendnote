import { z } from "zod";
import { getGiftIdea, getGiftPlan } from "../gift-plans";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject } from "./define";

const ideaRef = z.object({ giftIdeaId: z.uuid() });

/**
 * A Gift Plan is not owner-only: contribution rests on being in the plan's
 * audience, so these read by the caller's view rather than narrowing to the
 * owner. The Surprise Subject is refused at that same gate, so a plan somebody
 * is the surprise for is `null` here exactly as it is everywhere else.
 */
function visiblePlan(input: { giftPlanId: string }, callerUserId: string) {
  return getGiftPlan({ callerUserId, giftPlanId: input.giftPlanId });
}

function visibleIdea(input: { giftIdeaId: string }, callerUserId: string) {
  return getGiftIdea({ callerUserId, giftIdeaId: input.giftIdeaId });
}

export const giftPlanApprovalSubjects: ApprovalSubjectDescribers = {
  add_gift_idea: defineSubject({
    schema: z.object({
      giftPlanId: z.uuid(),
      title: z.string().min(1),
      note: z.string().optional(),
      url: z.string().optional(),
    }),
    load: visiblePlan,
    describe: (plan, input) =>
      subject(`Add an idea to the gift plan for ${plan.subjectName}`, [
        detail("Idea", input.title),
        detail("Note", input.note),
        detail("Link", input.url),
        "Everyone planning with you sees it, attributed to you.",
      ]),
  }),

  edit_gift_idea: defineSubject({
    schema: ideaRef.extend({
      title: z.string().optional(),
      note: z.string().nullish(),
      url: z.string().nullish(),
    }),
    load: visibleIdea,
    describe: ({ idea, plan }, input) =>
      subject(`Change your idea on the gift plan for ${plan.subjectName}`, [
        detail("Now", idea.title),
        detail("Becomes", input.title),
        detail("Note", input.note === null ? "(cleared)" : input.note),
        detail("Link", input.url === null ? "(cleared)" : input.url),
      ]),
  }),

  remove_gift_idea: defineSubject({
    schema: ideaRef,
    load: visibleIdea,
    describe: ({ idea, plan }) =>
      subject(`Take your idea off the gift plan for ${plan.subjectName}`, [
        detail("Idea", idea.title),
        "Removal is permanent: a plan keeps no archive of ideas.",
      ]),
  }),
};
