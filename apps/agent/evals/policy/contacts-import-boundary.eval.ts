import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Contacts import requests stay on the Account import surface without Eve tools.",
  tags: ["deterministic", "policy", "contacts-import"],
  async test(t) {
    await t.send("Preview my Google Contacts import here and add useful people from it.");

    t.succeeded();
    t.usedNoTools();
    t.check(t.reply, includes(/contact|import|account/i));
  },
});
