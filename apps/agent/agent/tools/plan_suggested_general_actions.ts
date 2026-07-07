import { suggestGeneralAction } from "@tendnote/db/queries/general-actions";
import { generalActionRecurrenceSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

/**
 * Hard cap on how many Suggested General Actions one planning call may propose.
 * Shallow planning is a SMALL set of review-gated suggestions, never a deep task
 * tree or a bulk generator (ADRs 0163, 0166). The cap is enforced here in the tool
 * schema so a single request can never fan out into an autonomous pile of proposals.
 */
export const MAX_SHALLOW_PLAN_ACTIONS = 5;

const stepSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("One proposed step, in plain language (e.g. 'Book the campsite')."),
  notes: z.string().optional().describe("Optional extra detail for this step."),
  dueAt: z
    .string()
    .optional()
    .describe("Optional concrete proposed due date as an ISO 8601 string. Omit if unscheduled."),
  recurrence: generalActionRecurrenceSchema
    .nullish()
    .describe("Optional simple cadence if this step is a recurring Routine. Usually omitted."),
  areaId: z.uuid().optional().describe("Optional Area to file this step under."),
  personIds: z
    .array(z.uuid())
    .optional()
    .describe("Optional people this step is about — context links, resolved with search_people."),
});

const inputSchema = z.object({
  sourceRecordId: z
    .uuid()
    .describe(
      "The source record grounding the whole plan — typically the planning note you just logged for this request. Every proposed step is grounded in it. Log the request as a note first if there is nothing to ground on.",
    ),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(MAX_SHALLOW_PLAN_ACTIONS)
    .describe(
      `The small flat set of proposed steps (at most ${MAX_SHALLOW_PLAN_ACTIONS}). A shallow plan only — no sub-steps, dependencies, or phases. Keep it to the few concrete actions that actually move the request forward.`,
    ),
  directlyRequested: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the user directly asked about delicate context. Restricted source records are excluded from proactive suggestion by default.",
    ),
});

/**
 * Shallow planning (ADR 0163): turns one explicit planning request into a SMALL,
 * flat set of review-gated Suggested General Actions, each grounded in the same
 * source record and each promoted only if the user accepts it. Deliberately shallow —
 * it proposes a handful of concrete steps, never projects, subtasks, dependencies, or
 * kanban plans (excluded by ADR 0166), and never active actions. The cap is enforced
 * in the schema so the tool cannot fan out into autonomous bulk creation. Each step
 * flows through the same review-gated suggestion seam a single `suggest_general_action`
 * uses, so the review, grounding, and scope posture are identical.
 */
export default defineTool({
  description: `Break ONE explicit planning request ('help me plan the camping trip', 'what are the steps to onboard the new hire?') into a SMALL flat set of SUGGESTED General Actions (at most ${MAX_SHALLOW_PLAN_ACTIONS}) for the user to review. All steps are grounded in one sourceRecordId — log the planning request as a note first if you have nothing to ground on. This is shallow planning only: a few concrete steps, never sub-tasks, dependencies, phases, projects, or a kanban board, and never active actions. Every step is tentative until the user accepts it. Use this only when the user explicitly asks you to plan or break something down; for a single suggestion use suggest_general_action, and to add a real action use create_general_action on an explicit ask. Returns the proposed steps and their review components; refer to them by title, never raw ids.`,
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    // Propose each step through the same review-gated seam in order, so a shallow plan
    // is just a small batch of ordinary suggestions — no special bulk path, no active
    // writes. Sequential keeps the persisted/embedded order stable and predictable.
    const proposed = [];
    for (const step of input.steps) {
      const result = await suggestGeneralAction({
        ownerUserId,
        title: step.title,
        notes: step.notes ?? null,
        dueAt: step.dueAt ? new Date(step.dueAt) : null,
        recurrence: step.recurrence ?? null,
        areaId: step.areaId ?? null,
        personIds: step.personIds,
        sourceRecordId: input.sourceRecordId,
        directlyRequested: input.directlyRequested,
      });
      proposed.push({
        component: result.component,
        action: toGeneralActionRef(result.action),
      });
    }

    return {
      found: true as const,
      count: proposed.length,
      proposed,
    };
  },
  // Keep the titles/status so the model can frame the plan and act on a specific step
  // when the user asks; ids never reach the model.
  // TODO(#186): per-step review cards are not wired into the chat surface yet, so the
  // model must lay out the proposed steps in prose. Once #186 renders the cards, tell
  // the model to summarize and defer detail to them.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        planned: true,
        count: output.count,
        steps: output.proposed.map((item) => toGeneralActionModelRef(item.action)),
        guidance:
          "These are TENTATIVE suggestions, not active actions. Lay out the proposed steps briefly in prose; add any of them to the active ledger only on the user's explicit say-so.",
      },
    };
  },
});
