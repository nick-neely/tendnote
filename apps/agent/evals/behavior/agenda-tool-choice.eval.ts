import { defineEval } from "../define-eval";

export default defineEval({
  description: "Broad relationship planning uses the read-only agenda tool.",
  tags: ["deterministic", "behavior", "tool-choice"],
  async test(t) {
    await t.send("What relationship follow-ups or check-ins are coming up this week?");

    t.succeeded();
    t.eventsSatisfy("uses a read-only relationship planning tool", (events) =>
      events.some(
        (event) =>
          event.type === "actions.requested" &&
          event.data.actions.some(
            (action) =>
              action.kind === "tool-call" &&
              (action.toolName === "get_relationship_agenda" ||
                action.toolName === "list_due_followups"),
          ),
      ),
    );
    t.notCalledTool("create_followup");
    t.notCalledTool("propose_followup");
    t.notCalledTool("create_message_draft");
  },
});
