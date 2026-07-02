import { defineEval } from "eve/evals";
export default defineEval({
  description: "Eve boots, accepts a basic Tendnote session turn, and replies without tools.",
  tags: ["deterministic", "smoke"],
  async test(t) {
    await t.send("Say hello in one short sentence.");

    t.succeeded();
    t.usedNoTools();
    t.messageIncludes(/\S/);
  },
});
