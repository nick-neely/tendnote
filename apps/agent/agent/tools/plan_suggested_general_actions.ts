import { withDatabaseTransaction } from "@tendnote/db/client";
import { suggestGeneralAction } from "@tendnote/db/queries/general-actions";
import { generalActionRecurrenceSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * Hard cap on how many Suggested General Actions one planning call may propose.
 * Shallow planning is a SMALL set of review-gated suggestions, never a deep task
 * tree or a bulk generator (ADRs 0163, 0166). The cap is enforced here in the tool
 * schema so a single request can never fan out into an autonomous pile of proposals.
 */
export const MAX_SHALLOW_PLAN_ACTIONS = 5;

/**
 * One proposed step. Deliberately a subset of what `suggest_general_action` takes:
 * there is no `links`, and that is the decision rather than an oversight.
 *
 * A single suggestion is grounded in a record the user produced, so a link on it
 * can be one they supplied. A plan is grounded in one note - "help me plan the
 * camping trip" - and then decomposed by the model, so a URL on step 3 has no
 * source but the model itself. That is the one thing a review-gated proposal must
 * never smuggle in, and here it would arrive up to five at a time. A link the user
 * actually wants goes on the step after they accept it, with
 * `edit_general_action`, where they are looking at the action they own.
 */
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
  areaId: z
    .uuid()
    .optional()
    .describe(
      "Optional Area to file this step under, taken from list_general_action_areas — never an invented id.",
    ),
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

    /**
     * A plan is one thing, so it commits as one thing.
     *
     * Each step used to be its own commit. A failure at step k therefore left k-1
     * Suggested General Actions in the user's review queue and told the model the
     * whole call had failed - half a plan the user never asked for, presented as
     * nothing at all, with no way for either of them to tell which half. Every
     * store call under the shared ambient transaction joins it through `getDb()`,
     * so the loop becomes atomic without a bulk entry point the seam does not have.
     *
     * Still sequential inside the boundary: it keeps the persisted and embedded
     * order stable, and it is still the same ordinary review-gated seam a single
     * `suggest_general_action` uses - no special bulk path, no active writes.
     */
    const outcomes = await withModelSafeStoreErrors(() =>
      withDatabaseTransaction(async () => {
        const written = [];
        for (const step of input.steps) {
          written.push(
            await suggestGeneralAction({
              ownerUserId,
              title: step.title,
              notes: step.notes ?? null,
              dueAt: step.dueAt ? new Date(step.dueAt) : null,
              recurrence: step.recurrence ?? null,
              areaId: step.areaId ?? null,
              personIds: step.personIds,
              sourceRecordId: input.sourceRecordId,
              directlyRequested: input.directlyRequested,
            }),
          );
        }
        return written;
      }),
    );

    // After the commit, never inside it: reconciliation is a cache call, and a
    // transport failure there must not roll back a plan the user can already see.
    for (const outcome of outcomes) {
      await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    }

    const proposed = outcomes.map((outcome) => ({
      component: outcome.result.component,
      action: toGeneralActionRef(outcome.result.action),
    }));

    return {
      found: true as const,
      count: proposed.length,
      proposed,
    };
  },
  // Keep the titles/status so the model can frame the plan and act on a specific step
  // when the user asks; ids never reach the model. Each step renders as its own
  // interactive review card (Accept/Dismiss), so the model frames the plan and defers.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        planned: true,
        count: output.count,
        steps: output.proposed.map((item) => toGeneralActionModelRef(item.action)),
        rendered: "Each proposed step is shown to the user as its own review card.",
        guidance:
          "These are TENTATIVE suggestions, each shown as its own review card the user can accept or dismiss. Frame the plan in a sentence or two; don't relist every step. None is active until they accept it.",
      },
    };
  },
});
