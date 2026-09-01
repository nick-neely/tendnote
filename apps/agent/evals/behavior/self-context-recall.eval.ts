import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

export default defineEval({
  description:
    "A direct question about the owner uses exact categorized Self Context recall instead of a profile.",
  tags: ["deterministic", "behavior", "self-context", "recall", "phase-seven-point-five"],
  async test(t) {
    await t.send(
      "What do you know about me? Return the exact active Self Context facts by category, and do not make a personality profile or infer anything.",
    );

    t.succeeded();
    t.calledTool("list_self_context");
    t.notCalledTool("get_person_context");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_saved_item");
    t.check(t.reply, includes(NO_RAW_IDS));
    t.check(t.reply, includes(without("personality profile|generated profile|you seem like")));
  },
});
