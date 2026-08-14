import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

/**
 * The in-between `propose_suggested_memory` was built to be.
 *
 * Eve had `capture_memory` for "remember this" and nothing for a fact that
 * merely came up - so a fact worth keeping either became an approved memory it
 * was not entitled to write, or evaporated. This turn is the shape that gap had:
 * the user logs a note and mentions something in passing, without ever saying
 * remember.
 *
 * Both halves are gates. The proposal must be grounded in a source record that
 * exists (the tool takes a `sourceRecordId`, so the note has to be logged first),
 * and the answer must not describe a review card as a saved fact - the failure
 * the tool's whole output projection is shaped to prevent.
 */
export default defineEval({
  description:
    "A fact that merely came up is proposed for review against a logged note, never saved as an approved memory.",
  tags: ["deterministic", "behavior", "memory", "review-gate"],
  async test(t) {
    await t.send(
      "Log a note about my call with Priya Shah: we went through the launch checklist. She also mentioned her sister is moving to Denver in August.",
    );

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Priya/i } });
    // The note is the grounding, and it has to exist before the proposal can reference it.
    t.calledTool("capture_source_record");
    t.calledTool("propose_suggested_memory", { input: { content: /Denver|sister/i } });
    t.toolOrder(["capture_source_record", "propose_suggested_memory"]);
    // "Remember" was never said, so nothing durable may be written.
    t.notCalledTool("capture_memory");
    t.notCalledTool("approve_suggested_memory");
    // And the review card is not reported as a saved fact.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (saved|logged|noted|remembered) that (her|Priya(’|')?s) sister|I(’|')?ll remember (that|her sister)|saved (it )?as a memory",
        ),
      ),
    );
    t.check(t.reply, includes(/review|approve|suggestion|waiting/i));
  },
});
