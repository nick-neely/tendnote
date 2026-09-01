import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { toolOutputs, without } from "../expectations";

/**
 * The nag rule (#203, #205): a proposal the owner turned down never comes back.
 *
 * In the seeded world, the Toyota Corolla's "Oil change interval" detail already proposed a
 * reminder once and the owner dismissed it. The proposal seam is idempotent per memory, so a
 * fresh pass over that asset has nothing to say — and an empty pass is a real,
 * calm answer, not an invitation to be helpful. This is the moment the review gate is worth
 * something: an assistant that re-proposes what you just rejected has turned a review queue
 * into a nag loop, and the deterministic seam is only half the defense. The other half is
 * that Eve accepts the silence — she must not "helpfully" create the reminder directly, and
 * she must not re-offer it in prose.
 */
export default defineEval({
  description:
    "A detail whose proposal the owner dismissed is not re-proposed, and Eve neither creates it nor re-offers it.",
  tags: ["deterministic", "policy", "assets", "general-actions"],
  async test(t) {
    await t.send("Look at the Toyota Corolla's details and propose any reminders it should have.");

    t.succeeded();
    t.calledTool("propose_asset_actions");

    // The seam is the security boundary; assert it actually said nothing, so the reply below
    // is being judged against an empty pass rather than a lucky one.
    t.eventsSatisfy("the proposal pass proposed nothing", (events) =>
      toolOutputs(events, "propose_asset_actions").some(
        (output) =>
          typeof output === "object" &&
          output !== null &&
          Array.isArray((output as { proposed?: unknown[] }).proposed) &&
          (output as { proposed: unknown[] }).proposed.length === 0,
      ),
    );

    // The dismissed suggestion must not come back through another door.
    t.notCalledTool("create_general_action");
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    // A calm, honest empty answer. The load-bearing half is the claim ban: whatever words she
    // chooses, she must not present a reminder she did not make — re-offering the dismissed
    // suggestion in prose is the same nag, wearing a different hat.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set up|proposed)|I(’|')?ll add|reminder is (now )?set|here(’|')?s (a|the) new reminder|I(’|')?ve suggested",
        ),
      ),
    );
    // Deliberately no gate on *how* she phrases the empty pass. The rule is that the dismissed
    // reminder does not come back — through the seam, through another tool, or as a claim — and
    // that is exactly what the four gates above assert. A phrasing gate here would police
    // wording, not the boundary, and would fail honest answers for using different words.
  },
});
