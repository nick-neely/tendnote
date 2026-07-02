import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description:
    "Judge whether broad relationship strategy is prioritized, grounded, and review-gated.",
  tags: ["judged", "quality", "relationship-strategy", "subagent"],
  async test(t) {
    const turn = await t.send(
      "Who should I prioritize this week, and what thoughtful next action should I consider? Keep it calm and reviewable: don't infer anyone is waiting, don't pressure me, and don't set active reminders.",
    );
    const agendaCall = turn.requireToolCall("get_relationship_agenda");

    t.succeeded();
    t.calledTool("get_relationship_agenda");
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.check(
      turn.message,
      satisfies(
        (reply) =>
          !/(relationship impact|connection momentum|psychologically harder|work-critical|waiting to hear if you care|waiting on|what'?s actually waiting on you|deserves a quick check-in|she'?s waiting|you owe|blocking work|offer or processing a rejection|celebrating an offer|thinking about what'?s next|removes? the awkwardness|awkwardness|brief apology|apologize|left hanging|draft ready|slip further|clear overdue items|set an active reminder|concrete obligation|real deliverable|project moving forward|maintains? (a )?(close )?friendship|strengthens? (those )?relationships?|\bpipeline\b|\bdeal\b|lead score|outreach automation)/i.test(
            String(reply),
          ),
        "avoids CRM and productivity-pressure framing",
      ),
    );
    t.judge.autoevals
      .closedQA(
        "Given the agenda context and reply, is this a useful private Tendnote relationship strategy? Answer yes only if it prioritizes a small number of people or next actions, grounds recommendations in the provided agenda context, treats actions as owner-reviewable options rather than active obligations, avoids CRM/sales/outreach automation framing, and does not invent personal facts.",
        { on: JSON.stringify({ reply: turn.message, agenda: agendaCall.output }) },
      )
      .atLeast(0.7);
  },
});
