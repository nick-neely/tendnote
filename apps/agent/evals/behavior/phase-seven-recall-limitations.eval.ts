import { includes, satisfies } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, toolOutputs, without } from "../expectations";

export function statesPurchaseLocationLimitation(reply: string) {
  return (
    /(?:no|not|don'?t|doesn'?t|isn'?t|nothing|never)[^.!?]{0,180}(?:where to buy|buying|purchase|retailer|seller|store)/i.test(
      reply,
    ) ||
    /(?:can(?:not|'t) confirm)[^.!?]{0,80}(?:where to buy|retailer|seller|store)|(?:won't|will not) recommend[^.!?]{0,40}(?:retailer|seller|store)/i.test(
      reply,
    )
  );
}

export default defineEval({
  description:
    "Global Recall cites the reviewed filter fact while naming the unresolved purchase-location limitation.",
  tags: ["deterministic", "behavior", "global-recall", "limitations", "phase-seven"],
  async test(t) {
    await t.send(
      "Use Global Recall across all my Tendnote records for the kitchen refrigerator filter, not the Asset-only search. Tell me the exact filter model, and if the records do not confirm where to buy it, say that limitation explicitly instead of recommending a store.",
    );

    t.succeeded();
    t.calledTool("search_global_recall", {
      input: { includeRestricted: false },
    });
    t.eventsSatisfy("recall returns canonical links and grounding citations", (events) =>
      toolOutputs(events, "search_global_recall").some((output) => {
        const results = (output as { results?: Array<{ grounding?: unknown[]; href?: string }> })
          .results;
        return (
          results?.some(
            (result) => result.href?.startsWith("/") && (result.grounding?.length ?? 0) > 0,
          ) ?? false
        );
      }),
    );
    t.check(t.reply, includes(/EDR1RXD1/));
    // The limitation has to be *stated*, not merely on-topic. The prompt already
    // contains "where to buy" and "store", so the old alternation passed on a reply
    // that repeated the question; this one needs the negation next to the subject,
    // which is what saying "the records don't cover that" looks like.
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && statesPurchaseLocationLimitation(reply),
        "states that the records do not confirm a purchase location",
      ),
    );
    t.check(t.reply, includes(NO_RAW_IDS));
    t.check(t.reply, includes(without("Amazon|Home Depot|Lowe.?s|Walmart")));
    t.check(t.reply, includes(without("buy it (at|from)|available at|sold by|order it from")));
    t.notCalledTool("capture_saved_item");
    t.notCalledTool("create_general_action");
  },
});
