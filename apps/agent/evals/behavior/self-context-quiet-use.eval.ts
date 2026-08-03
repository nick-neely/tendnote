import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description:
    "An unrelated answer stays quiet and does not volunteer Self Context when no personal context is relevant.",
  tags: ["deterministic", "behavior", "self-context", "relevance", "phase-seven-point-five"],
  async test(t) {
    await t.send(
      "Give me a short explanation of how a database index works. Keep it focused and do not mention stored personal context unless it is relevant.",
    );

    t.succeeded();
    t.notCalledTool("list_self_context");
    t.notCalledTool("get_person_context");
    t.check(t.reply, includes(/index|database|query/i));
    t.check(t.reply, includes(without("I know about you|your saved facts|personal profile")));
  },
});
