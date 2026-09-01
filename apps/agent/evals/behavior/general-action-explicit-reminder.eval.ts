import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { NO_RAW_IDS, without } from "../expectations";

export default defineEval({
  description:
    "An explicit Action plus concrete notification request creates one Action with one Reminder Schedule.",
  tags: ["deterministic", "behavior", "general-actions", "reminders"],
  async test(t) {
    await t.send(
      "Add an action to replace the fridge water filter tomorrow and remind me at 3 PM.",
    );

    t.succeeded();
    t.calledTool("create_general_action", {
      input: {
        title: /replace.*water filter/i,
        dueAt: /\d{4}-\d{2}-\d{2}/,
        reminderSchedule: (value: unknown) => {
          if (!value || typeof value !== "object") return false;
          const schedule = value as { kind?: unknown; localTime?: unknown };
          return schedule.kind === "exact" && schedule.localTime === "15:00";
        },
      },
      count: 1,
    });
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("propose_asset_actions");
    t.check(t.reply, includes(/remind|scheduled|alert/i));
    t.check(t.reply, includes(NO_RAW_IDS));
    t.check(
      t.reply,
      includes(
        without("I(’|')?m not sure|could not schedule|no notification|waiting for (your )?review"),
      ),
    );
  },
});
