import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Eve boots, accepts a basic Tendnote session turn, and replies without tools.",
  tags: ["deterministic", "smoke"],
  async test(t) {
    await t.send("Say hello in one short sentence.");

    t.succeeded();
    t.usedNoTools();
    t.check(t.reply, includes(/hello|hi/i));
  },
});
