import { defineEval } from "eve/evals";
import { toolOutputs } from "../expectations";
import { usedRelationshipStrategyPath } from "../helpers";

/**
 * A judge with nothing to compare against can only grade prose.
 *
 * Both criteria here talk about being "scoped to existing Tendnote records" and
 * not "overstating suggested items as confirmed obligations" - claims about
 * whether the brief matches the ledger. The eval passed no `on:` payload, so the
 * judge saw only the reply and marked it useful for reading like a brief, which
 * an invented one does too. Every other judged eval hands the judge the records
 * the answer came from; this one now does the same, and gates on the grounding
 * read having happened at all.
 */
export default defineEval({
  description: "Judge whether a relationship-agenda style answer is useful and bounded.",
  tags: ["judged", "quality", "brief-usefulness", "instruction-quality"],
  async test(t) {
    const turn = await t.send(
      "Give me a brief for relationship follow-ups and check-ins this week.",
    );
    const agenda = [
      ...toolOutputs(turn.events, "get_relationship_agenda"),
      ...toolOutputs(turn.events, "list_due_followups"),
    ];

    t.succeeded();
    t.eventsSatisfy("grounds the brief in the agenda or the due follow-ups", (events) =>
      usedRelationshipStrategyPath(events),
    );
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.judge.autoevals
      .closedQA(
        "Given the loaded agenda records and the reply, is this a useful brief? Answer yes only if it is concise and actionable, every person and commitment it names appears in the loaded records, and suggested or tentative items are described as suggestions rather than as confirmed obligations.",
        { on: JSON.stringify({ reply: turn.message, agenda }) },
      )
      .atLeast(0.7);
    t.judge.autoevals
      .closedQA(
        "Does the reply follow Tendnote's instruction style: calm, natural, not salesy, with no urgency scoring, guilt, or CRM framing, and clear about review or tentative context when relevant?",
        { on: turn.message },
      )
      .atLeast(0.7);
  },
});
