import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Recall answers are grounded in stored relationship records.",
  tags: ["deterministic", "behavior", "grounded-recall"],
  async test(t) {
    await t.send("What do I know about Alex's job search?");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledTool("get_person_context");
    t.toolOrder(["search_people", "get_person_context"]);
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.check(t.reply, includes(/Alex|backend|platform|job/i));
  },
});
