import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * The Phase 6 proof scenario (#196, #205): the refrigerator water filter.
 *
 * The seeded world holds a household Kitchen refrigerator whose reviewed details carry an exact
 * filter size, a receipt and a manual on file, and a Refrigerator water filter asset that *fits*
 * it — the Phase 5 asset hint, grown into a real Asset. The whole point of Asset Memory is that
 * this question has one right answer and Tendnote gives it verbatim: a part number that is nearly
 * right is worse than no answer at all, so this asserts the exact string rather than a paraphrase.
 *
 * The fixture is rigged so that only one path to the right answer exists. The asset's cached
 * snapshot is deliberately **stale**: it still names the cartridge the fridge used to take
 * (`XWFE`), and it is served, not rebuilt. The true value (`EDR1RXD1`) lives in exactly one place
 * — the reviewed Asset Memory — and nowhere else in the world (the linked Routine's notes
 * deliberately do not repeat it). So the pair of gates below is a single question with no way to
 * fluke it: say `EDR1RXD1` and never `XWFE`, and the answer can only have come from the records.
 * A snapshot is a rebuildable cache, never source truth — this is where that stops being a claim.
 */
export default defineEval({
  description:
    "Eve answers the water-filter question from the Asset records — the exact stored value, not the stale snapshot's.",
  tags: ["deterministic", "behavior", "assets", "asset-recall"],
  async test(t) {
    await t.send(
      "What filter does the kitchen fridge need, and what else do you have on file for it?",
    );

    t.succeeded();
    t.calledTool("search_assets");
    // Asset recall is its own seam — a thing you own is not relationship context.
    t.notCalledTool("search_relationship_context");
    t.notCalledTool("search_semantic_context");
    // The reviewed record's value, exactly as stored…
    t.check(t.reply, includes(/EDR1RXD1/));
    // …and never the generated summary's, which says otherwise and is wrong.
    t.check(t.reply, includes(without("XWFE")));
    // Evidence is grounding, not a claim: a receipt and a manual are on file, never read.
    t.check(t.reply, includes(/receipt|manual|on file/i));
    // Ids are for tool calls; a person never sees one.
    t.check(t.reply, includes(NO_RAW_IDS));
    // The unreviewed ice-maker suggestion on this same asset is not a fact, and must not read
    // as one.
    t.check(t.reply, includes(without("F2WC9I1")));
    // Nothing is written to answer a question.
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_general_action");
  },
});
