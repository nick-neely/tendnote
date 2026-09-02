import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * `update_person` had no eval of any kind.
 *
 * It is the only tool that edits a Person's own fields, and the suite neither
 * proved it works nor proved Eve leaves it alone - so both directions were open.
 * This asks for the correction the tool is for, in the shape it requires: a
 * resolved person, and only the field the user actually restated.
 */
export default defineEval({
  description:
    "A stated correction to a person's own details updates that person, and only the field they corrected.",
  tags: ["deterministic", "behavior", "people"],
  async test(t) {
    // Lee deliberately: the least-referenced seeded person, with no birthday of their
    // own, so this eval adds a field nothing else in the suite reads.
    await t.send("Lee Chen's birthday is March 4th - please add it to their profile.");

    t.succeeded();
    // Identity is resolved, never guessed: the tool takes a personId and nothing else.
    t.calledTool("search_people", { input: { query: /Lee/i } });
    t.calledTool("update_person", { input: { birthday: /03-04$/ }, count: 1 });
    t.toolOrder(["search_people", "update_person"]);
    // A correction to a stored field is not a memory, a note, or a reminder.
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_person");
    t.check(t.reply, includes(NO_RAW_IDS));
    // The year was never given, so no year may be reported. The schema accepts `--MM-DD`
    // precisely so a month/day birthday does not have to be dressed up as a full date.
    t.check(t.reply, includes(without("19\\d\\d|20[0-2]\\d")));
  },
});
