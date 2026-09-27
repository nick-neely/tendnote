import { recordActivationMilestone } from "@tendnote/db/queries/activation-milestones";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";
import { resolveAssistantConversationOwner } from "./assistant-conversation";

/**
 * Stamps the "first grounded Eve answer" Activation Milestone (ADR 0242).
 *
 * First Value's fourth step is asking Eve about a person and getting an answer
 * built from what the owner said. Here that is a web-chat turn that completes
 * after `get_person_context`, the named-person read, returned the person with
 * at least one confirmed Memory or logged note. The milestone records only that
 * it happened and when, never the person or the answer.
 *
 * `action.result` marks the turn in durable session state, and `turn.completed`
 * stamps it, so a turn that fails after the read is not counted and a turn that
 * resumes in another process still is. Like every hook here, a failure is
 * logged and swallowed: a missed timestamp must never fail a turn.
 */

const PERSON_CONTEXT_TOOL = "get_person_context";

const groundedTurn = defineState<{ turnId: string | null }>(
  "tendnote.activation-grounded-turn",
  () => ({ turnId: null }),
);

type ActionResult = { kind: string; toolName?: string; output?: unknown; isError?: boolean };

/** Whether one tool result is the owner's own records about a person. */
export function isGroundingResult(result: ActionResult): boolean {
  if (result.kind !== "tool-result" || result.isError || result.toolName !== PERSON_CONTEXT_TOOL) {
    return false;
  }
  const output = result.output as {
    found?: unknown;
    approvedMemories?: unknown;
    sourceRecords?: unknown;
  } | null;
  if (output?.found !== true) return false;

  const count = (records: unknown) => (Array.isArray(records) ? records.length : 0);
  return count(output.approvedMemories) + count(output.sourceRecords) > 0;
}

export type ActivationMilestoneHookDependencies = {
  record?: typeof recordActivationMilestone;
  warn?: (message: string, detail: unknown) => void;
};

export const createActivationMilestoneHook = (
  dependencies: ActivationMilestoneHookDependencies = {},
) => {
  const record = dependencies.record ?? recordActivationMilestone;
  const warn = dependencies.warn ?? ((message, detail) => console.warn(message, detail));

  return defineHook({
    events: {
      "action.result"(event, ctx) {
        if (!resolveAssistantConversationOwner(ctx.session)) return;
        if (!isGroundingResult(event.data.result)) return;

        try {
          groundedTurn.update(() => ({ turnId: event.data.turnId }));
        } catch (error) {
          warn("activation-milestones: could not mark a grounded turn", error);
        }
      },

      async "turn.completed"(event, ctx) {
        const userId = resolveAssistantConversationOwner(ctx.session);
        if (!userId) return;

        try {
          if (groundedTurn.get().turnId !== event.data.turnId) return;
          groundedTurn.update(() => ({ turnId: null }));
          await record({ userId, milestone: "first_grounded_eve_answer" });
        } catch (error) {
          warn("activation-milestones: could not record a grounded answer", error);
        }
      },
    },
  });
};

export default createActivationMilestoneHook();
