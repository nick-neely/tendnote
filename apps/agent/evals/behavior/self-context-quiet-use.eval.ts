import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
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
    // Not `/index|database|query/`: the prompt says "how a database index works", so
    // that gate passed on the question restated. An actual explanation reaches for how
    // the lookup works, which the prompt does not supply.
    t.check(t.reply, includes(/b-?tree|lookup|scan|faster|speeds? up|column|row/i));
    t.check(t.reply, includes(without("I know about you|your saved facts|personal profile")));
  },
});
