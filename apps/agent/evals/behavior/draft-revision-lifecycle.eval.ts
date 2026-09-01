import { satisfies } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, someToolOutputHasFields, toolOutputs } from "../expectations";
import { isDraftRevisionReplyCanonical } from "./draft-revision-assertions";

/**
 * The drafts Eve can now reach again (`list_message_drafts`, `edit_draft_body`,
 * `dismiss_draft`), walked once.
 *
 * Before these tools, a draft's id survived exactly one turn, so "make that one
 * shorter" and "scrap it" were both unanswerable. The three turns here are that
 * whole gap: read the drafts back, change the one the user names, throw it away
 * when they say so - each id coming from the read, never from a guess.
 *
 * The subject is the seeded Casey birthday draft, and the eval ends by dismissing
 * it. That is deliberate: a dismissed draft is a terminal state no other eval
 * reads, whereas an edited-but-live draft would leave altered text behind for the
 * drafting evals to trip over.
 */
export default defineEval({
  description:
    "Existing drafts are read back, revised in place, and dismissed on the user's say-so.",
  tags: ["deterministic", "behavior", "drafting", "lifecycle"],
  // 3 turns against a live model, so the run-wide single-turn budget does not fit.
  timeoutMs: 180_000,
  async test(t) {
    const listed = await t.send("What message drafts do I have?");

    listed.expectOk();
    listed.calledTool("list_message_drafts");
    // Reading drafts writes nothing.
    listed.notCalledTool("create_message_draft");
    listed.notCalledTool("edit_draft_body");
    listed.notCalledTool("dismiss_draft");
    // Ids are handles for tool calls, never text for a person.
    listed.messageIncludes(NO_RAW_IDS);

    const edited = await t.send(
      "Take the birthday one for Casey and add a line offering to get coffee.",
    );

    edited.expectOk();
    // A revision edits the draft that exists; it does not write a second one beside it.
    edited.calledTool("edit_draft_body", { input: { body: /coffee/i }, count: 1 });
    edited.notCalledTool("create_message_draft");
    edited.notCalledTool("save_draft_to_gmail");
    edited.eventsSatisfy("the edit returned an active unapproved text draft", (events) =>
      someToolOutputHasFields(events, "edit_draft_body", {
        updated: true,
        status: "draft",
        channel: "text",
      }),
    );
    t.check(
      edited.message ?? "",
      satisfies(
        (reply) => typeof reply === "string" && isDraftRevisionReplyCanonical(reply, "draft"),
        "the edited-draft reply matches the canonical unapproved internal contract",
      ),
    );

    await t.send("Actually, scrap that draft.");

    t.succeeded();
    t.calledTool("dismiss_draft", { count: 1 });
    // Nothing leaves Tendnote, and no replacement is written unasked.
    t.notCalledTool("save_draft_to_gmail");
    t.notCalledTool("create_message_draft");
    t.eventsSatisfy("the final draft state is dismissed", (events) =>
      toolOutputs(events, "dismiss_draft").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        return (output as { status?: unknown }).status === "dismissed";
      }),
    );
  },
});
