import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { usedNoToolsOrSubagents } from "../helpers";

/**
 * Evidence lands on an Asset the user confirms (#196 stories 25-26, #205).
 *
 * A receipt with no destination is the first row of a document inbox, which Phase 6 explicitly
 * refuses to become: evidence exists to ground an Asset and its memories, so a file that belongs
 * to nothing has nothing to ground. The rule is therefore not "guess well" but "ask": when the
 * destination is unclear, Eve names the plus-menu and says the upload attaches to an Asset the
 * user picks — she does not file it somewhere plausible on their behalf.
 */
export default defineEval({
  description:
    "An upload with an unclear destination is routed to the plus-menu and attached to an Asset the user confirms — never filed on a guess.",
  tags: ["deterministic", "policy", "assets", "evidence-capture"],
  async test(t) {
    await t.send("I want to attach a photo of an appliance label. Where does it go?");

    t.succeeded();
    usedNoToolsOrSubagents(t);
    // The capture entry point, as it appears on screen.
    t.check(t.reply, includes(/plus|\+ ?menu|camera|photo library|file/i));
    // And the destination: an Asset, chosen or confirmed by the user.
    t.check(t.reply, includes(/asset|which|confirm|choose|pick|select/i));
  },
});
