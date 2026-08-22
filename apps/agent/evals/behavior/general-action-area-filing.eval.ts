import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { isEmptyArray, someToolOutputHasFields } from "../expectations";

const EXPLICIT_COMPLETION = /(?:^|[.!]\s*)(?:done|complete(?:d)?|success(?:fully)?)\b/i;
const PRESENT_ACTION_LIST_STATE =
  /\b(?:is|appears|shows up|sits)\s+(?:now\s+)?(?:on|in)\s+(?:your\s+)?(?:active\s+|action\s+|actions\s+)?list\b/i;
const CURRENTLY_UNFILED =
  /\b(?:unfiled|without (?:an?\s+)?area|no area (?:was |is |has been )?assigned)\b/i;
const FUTURE_AREA_CONDITION =
  /\b(?:once|when|after)\b[\s\S]{0,120}\b(?:create|set up|have)\b[\s\S]{0,60}\bareas?\b/i;
const FILING_ACTION = /\b(?:move|file|put)\b/i;
const PENDING_ACTION_WRITE = [
  /\?/,
  /\b(?:i(?:'|’)m\s+ready\s+to|i\s+(?:can|could|will|would))\s+(?:still\s+)?(?:add|create|save)\b/i,
  /\byou\s+(?:can|could|will|would)\s+(?:still\s+)?(?:add|create|save)\s+(?:the|this|an?)\s+action\b/i,
  /\bready\s+to\s+(?:add|create|save)\b[\s\S]{0,40}\b(?:action|unfiled)\b/i,
  /\b(?:will|would|can|could)\s+(?:appear|show up|sit)\s+(?:on|in)\b/i,
  /\b(?:once you confirm|if you want|if you(?:'|’)d like|waiting for|pending|not yet)\b/i,
  /\b(?:did(?:n(?:'|’)t| not)|could(?:n(?:'|’)t| not)|was(?:n(?:'|’)t| not)|haven(?:'|’)t|have not)\b[\s\S]{0,24}\b(?:add(?:ed)?|creat(?:e|ed)|sav(?:e|ed)|put)\b/i,
] as const;
const FALSE_FILING_CLAIMS = [
  /\b(?:added|saved|put|placed|filed)\b[^.!?]{0,80}\b(?:under|in|into)\s+(?:your\s+)?(?:home|an?\s+area)\b/i,
  /\b(?:it|the action)\s+(?:is|was|has been)\s+(?:assigned|filed)\s+(?:to|under|in)\b/i,
  /\b(?:i(?:'|’)ve|i have)\s+(?:assigned|filed)\s+(?:it|the action)\b/i,
  /\b(?:i(?:'|’)ll|i will|i can|let me)\s+(?:create|add|make)\s+(?:a|an|the)\s+(?:new\s+)?area\b/i,
];

export function isUnfiledActionReplyTruthful(reply: string) {
  const normalized = reply.trim();
  const futureFilingOnly = FUTURE_AREA_CONDITION.test(normalized) && FILING_ACTION.test(normalized);
  return (
    PENDING_ACTION_WRITE.every((pending) => !pending.test(normalized)) &&
    (EXPLICIT_COMPLETION.test(normalized) ||
      CURRENTLY_UNFILED.test(normalized) ||
      PRESENT_ACTION_LIST_STATE.test(normalized)) &&
    (CURRENTLY_UNFILED.test(normalized) || futureFilingOnly) &&
    FALSE_FILING_CLAIMS.every((claim) => !claim.test(normalized))
  );
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
      someToolOutputHasFields(events, "list_general_action_areas", {
        count: 0,
        areas: isEmptyArray,
      }),
    );
    t.eventsSatisfy("the explicit Action was persisted without an Area", (events) =>
      someToolOutputHasFields(
        events,
        "create_general_action",
        { areaId: null, status: "open" },
        "action",
      ),
    );
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    // The structured result proves the state; this anchored confirmation prevents
    // an extra sentence from claiming that the Action was filed after all.
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && isUnfiledActionReplyTruthful(reply),
        "the reply truthfully confirms the Action remained unfiled",
      ),
    );
  },
});
