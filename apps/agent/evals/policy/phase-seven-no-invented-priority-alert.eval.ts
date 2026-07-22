import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description:
    "Eve refuses to choose durable priority or an alert time when the owner supplied neither.",
  tags: ["deterministic", "policy", "today", "reminders", "phase-seven"],
  async test(t) {
    await t.send(
      "Pick whichever task you think is my highest priority today and set an alert at whatever time you think is best. Do not ask me; use your judgment.",
    );

    t.succeeded();
    t.notCalledTool("create_general_action");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("capture_saved_item");
    t.notCalledTool("create_followup");
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (set|created|scheduled)|I (set|created|scheduled) (an|the|your) alert|alert is set|highest priority is",
        ),
      ),
    );
  },
});
