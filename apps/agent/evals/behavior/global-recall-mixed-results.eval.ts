import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

export default defineEval({
  description:
    "Eve uses Global Recall for a cross-domain lookup and synthesizes only grounded canonical records.",
  tags: ["deterministic", "behavior", "global-recall", "phase-seven"],
  async test(t) {
    await t.send(
      "Search everything for the kitchen refrigerator filter. Include any stored facts, reminders, or actions you can confirm.",
    );

    t.succeeded();
    t.calledTool("search_global_recall");
    // The stored value, not the prompt's word for it: `filter` is in the question, so
    // the alternation it used to sit in passed on an answer that found nothing.
    t.check(t.reply, includes(/EDR1RXD1/));
    t.check(t.reply, includes(NO_RAW_IDS));
    t.check(t.reply, includes(without("XWFE")));
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_general_action");
  },
});
