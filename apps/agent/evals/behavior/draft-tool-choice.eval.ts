import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { without } from "../expectations";

export default defineEval({
  description: "Drafting resolves identity, delegates the first pass, and stays review-only.",
  tags: ["deterministic", "behavior", "drafting"],
  async test(t) {
    await t.send("Draft a short check-in text to Alex about the job search.");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    // `drafting.md` makes `message_drafter` the default path for a broad drafting
    // request, and this is a broad drafting request. The gate used to accept the
    // drafter OR a `get_person_context` read, which is not a drafting path at all -
    // every grounded answer that wrote nothing satisfied it.
    t.calledSubagent("message_drafter");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    // Draft Proposals are ephemeral until the owner accepts one. The reply may show
    // the wording; it may not claim Tendnote is holding it.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve saved|I saved (it|this|the draft)|it(’|')?s (now )?saved|saved (it )?(as a|to your) draft|added (it )?to your drafts",
        ),
      ),
    );
  },
});
