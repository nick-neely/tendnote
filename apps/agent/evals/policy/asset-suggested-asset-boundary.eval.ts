import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { without } from "../expectations";

/**
 * A thing Tendnote has never heard of becomes a *Suggested* Asset (#196 stories 11/57, #205).
 *
 * The user mentions a dishwasher that is not in their assets, and gives it a warranty date.
 * Eve must not quietly create the Asset to hang the fact on — an asset created from an
 * inference is exactly the "silent durable write" the review gate exists to stop, and an
 * asset the user never confirmed is a thing Tendnote *thinks* they own. The proposal covers
 * both: the Asset is suggested, the fact is suggested, and one accept resolves them together
 * in the existing Asset Review Group.
 *
 * The date is also the test of the typed value: a warranty that arrives as prose is a fact no
 * reminder can ever be proposed from, so the fact must land as a real `date`, not a sentence.
 */
export default defineEval({
  description:
    "An unknown thing is proposed as a Suggested Asset with its fact — never created outright.",
  tags: ["deterministic", "policy", "assets", "review-gate"],
  async test(t) {
    await t.send("My Bosch dishwasher's warranty runs out on 2027-03-14.");

    t.succeeded();
    // Search first — a fact must anchor to the asset the user already has, if they have one.
    t.calledTool("search_assets");
    // Nothing to anchor to, so the Asset is proposed alongside the fact, typed as a date.
    t.calledTool("propose_asset_memories", {
      input: {
        newAsset: { name: /dishwasher/i },
        details: [{ value: { type: "date", date: "2027-03-14" } }],
      },
    });
    t.notCalledTool("create_general_action");
    t.notCalledTool("capture_memory");
    // It says what it did: proposed, for review — never that the dishwasher is now tracked.
    t.check(t.reply, includes(/review|accept|confirm|approve/i));
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (saved|logged|recorded|added|created)|I have (saved|logged|added|created)|now (tracking|track)|it(’|')?s (saved|added|in your assets)",
        ),
      ),
    );
  },
});
