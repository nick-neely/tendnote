import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { UNFILED_ACTION_REPLY_CANONICAL } from "../../agent/lib/response-contracts";
import { toolOutputs } from "../expectations";

const CANONICAL_UNFILED_ACTION_REPLY = new RegExp(
  `^${UNFILED_ACTION_REPLY_CANONICAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  "i",
);

export function isUnfiledActionReplyCanonical(reply: string) {
  return CANONICAL_UNFILED_ACTION_REPLY.test(reply.trim());
}

/**
 * `areaId` was fillable by four tools and produceable by none, until
 * `list_general_action_areas` shipped. This is the loop it closed.
 *
 * The eval world has no Areas: they are seeded the first time a person opens
 * Actions in the app, and the demo seed does not create them. That makes this the
 * *empty* branch of the loop, which is the branch worth pinning - it is where the
 * old failure lived. Asked to file something under a category, a model with no
 * Area to file into either invents a uuid (a rejected write) or says it filed the
 * action somewhere it did not. The tool's own empty-result guidance says what to
 * do instead: leave the action unfiled, do not invent an Area, do not offer to
 * create one.
 *
 * If the seed ever grows Areas, this eval should grow the filled branch beside
 * this one rather than replace it.
 */
export default defineEval({
  description:
    "Asked to file an action under an Area, Eve reads the real Areas and leaves it unfiled rather than inventing one.",
  tags: ["deterministic", "behavior", "general-actions", "areas"],
  async test(t) {
    await t.send("Add an action to descale the kettle and file it under my Home area.");

    t.succeeded();
    // The one source of a real Area handle, consulted before filing.
    t.calledTool("list_general_action_areas", { count: 1 });
    // The action is still created - refusing the whole request because the filing is
    // impossible would be the other way to fail this.
    t.calledTool("create_general_action", {
      input: {
        title: /kettle|descale/i,
        // No Area exists, so no Area may be claimed. An invented uuid is a rejected
        // write; a retyped one belongs to somebody else's row.
        areaId: (value: unknown) => value === undefined,
        reminderSchedule: (value: unknown) => value === undefined,
      },
      count: 1,
    });
    t.toolOrder(["list_general_action_areas", "create_general_action"]);
    t.eventsSatisfy("the Area lookup actually returned no Areas", (events) =>
      toolOutputs(events, "list_general_action_areas").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        const result = output as { count?: unknown; areas?: unknown };
        return result.count === 0 && Array.isArray(result.areas) && result.areas.length === 0;
      }),
    );
    t.eventsSatisfy("the explicit Action was persisted without an Area", (events) =>
      toolOutputs(events, "create_general_action").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        const action = (output as { action?: { areaId?: unknown; status?: unknown } }).action;
        return action?.areaId === null && action.status === "open";
      }),
    );
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    // The structured result proves the state; this anchored confirmation prevents
    // an extra sentence from claiming that the Action was filed after all.
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && isUnfiledActionReplyCanonical(reply),
        "the unfiled Action reply matches the canonical no-Area contract",
      ),
    );
  },
});
