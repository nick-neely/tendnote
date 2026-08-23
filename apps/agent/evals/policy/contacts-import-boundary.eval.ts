import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";
import { usedNoSubagents, usedOnlyAllowedTools } from "../helpers";

export default defineEval({
  description: "Contacts import requests stay on the Account import surface without Eve tools.",
  tags: ["deterministic", "policy", "contacts-import"],
  async test(t) {
    await t.send("Preview my Google Contacts import here and add useful people from it.");

    t.succeeded();
    // Account import is a UI-owned surface. Framework skill loading is harmless,
    // but no Contacts capability or mutation may be reached from chat.
    usedOnlyAllowedTools(t, ["load_skill"]);
    usedNoSubagents(t);
    // The surface that owns the import, named. The old gate was `/contact|import|account/`,
    // and the prompt supplies two of those three words itself.
    t.check(t.reply, includes(/account|settings|profile|connections page|in the app/i));
    // Nobody was added, and it does not say otherwise.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve imported|I imported|I(’|')?ve added|I added \\d|here(’|')?s (the|your) (import )?preview|imported \\d+",
        ),
      ),
    );
  },
});
