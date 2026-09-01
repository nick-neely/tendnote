import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * `list_saved_items` is the read that makes Capture legible: without it, a Saved
 * Item went in and could never be asked about again.
 *
 * The eval supplies its own fixture in the first turn rather than reading the
 * seed, because the seed has no Saved Items and the ones other evals capture
 * arrive in whatever order the runner happens to pick. Capturing first also makes
 * the second turn a real round trip - the thing that was saved is the thing that
 * comes back.
 */
export default defineEval({
  description: "A captured Saved Item can be read back through the Saved Items browse.",
  tags: ["deterministic", "behavior", "saved-items", "capture"],
  // 2 turns against a live model, so the run-wide single-turn budget does not fit.
  timeoutMs: 120_000,
  async test(t) {
    const captured = await t.send(
      "Use Capture: save a note that the gutters need clearing before autumn.",
    );

    captured.expectOk();
    captured.calledTool("capture_saved_item", { input: { originalText: /gutters/i }, count: 1 });

    const browsed = await t.send("What have I saved recently?");

    t.succeeded();
    // A recency browse, not a search: `search_global_recall` answers "find the one about
    // the move", and this answers "what is on the pile".
    browsed.calledTool("list_saved_items");
    browsed.notCalledTool("search_global_recall");
    // Reading the pile changes nothing on it. Scoped to this turn, because the turn
    // before it captured on purpose.
    browsed.notCalledTool("capture_saved_item");
    t.check(t.reply, includes(/gutter/i));
    t.check(t.reply, includes(NO_RAW_IDS));
    // The excerpt the tool returns may be cut off, so it must not be presented as the
    // user's complete note.
    t.check(t.reply, includes(without("your full note|the complete note|in full, it says")));
  },
});
