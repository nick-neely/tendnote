import { defineEval } from "../define-eval";

export default defineEval({
  description:
    "A cross-domain 'what's on my plate' question composes read-only tools over both domains.",
  tags: ["deterministic", "behavior", "general-actions", "tool-choice"],
  async test(t) {
    await t.send(
      "What's on my plate right now — anyone I should follow up with and anything I need to get done?",
    );

    t.succeeded();
    // The Actions half is answered from the visible ledger, read-only.
    t.calledTool("list_general_actions");
    // The people/reminder half uses a read-only follow-up or agenda tool.
    t.eventsSatisfy("reads visible follow-ups or the relationship agenda", (events) =>
      events.some(
        (event) =>
          event.type === "actions.requested" &&
          event.data.actions.some(
            (action) =>
              action.kind === "tool-call" &&
              (action.toolName === "list_due_followups" ||
                action.toolName === "get_relationship_agenda"),
          ),
      ),
    );
    // A read-only cross-domain answer never mutates or creates.
    t.notCalledTool("create_general_action");
    t.notCalledTool("update_general_action_status");
  },
});
