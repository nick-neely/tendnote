import { defineEval } from "./define-eval";
import { usedNoToolsOrSubagents } from "./helpers";

export default defineEval({
  description:
    "Eve boots, accepts a basic Tendnote session turn, and replies without tools or delegation.",
  tags: ["deterministic", "smoke"],
  async test(t) {
    await t.send("Say hello in one short sentence.");

    t.succeeded();
    usedNoToolsOrSubagents(t);
    t.messageIncludes(/\S/);
  },
});
