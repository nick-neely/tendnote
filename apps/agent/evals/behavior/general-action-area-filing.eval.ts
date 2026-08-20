import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { toolOutputs, without } from "../expectations";

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
    t.calledTool("list_general_action_areas");
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
        const action = (output as { action?: { area?: unknown; areaId?: unknown } }).action;
        return action?.area === null || action?.areaId === null;
      }),
    );
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    t.check(t.reply, includes(/(created|added|saved|active|unfiled)/i));
    // And it does not report a filing that did not happen, or offer an Area it cannot make.
    t.check(
      t.reply,
      includes(
        without(
          "filed (it )?under (your |my |the )?Home(?: area)?|(?:added|saved|put|placed|left) (?:it|the (?:action|task)|that) (?:under|in|to) (?:your |my |the )?Home(?: area)?|in (?:your |my |the )?Home area|I(’|')?ve created (a|an|the) [a-z ]*area|create (a|an) (new )?area for you|I(’|')?ll (create|add) (a|an) (new )?area",
        ),
      ),
    );
  },
});
