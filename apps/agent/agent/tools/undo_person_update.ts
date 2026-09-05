import { undoPersonUpdate } from "@tendnote/db/queries/people";
import { personUpdateTargetSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

export default defineTool({
  // Undo consumes the inverse; there is no redo, so this tool remains always-ask.
  approval: requireOwnerApproval({ describe: describeRegisteredSubject() }),
  description:
    "Undo the latest person profile update when the owner asks. Use the exact undoTarget returned by update_person. The server restores stored prior values only if no newer edit superseded this one. Report the returned status honestly: applied, already_undone, superseded, or unavailable. This call pauses for the user's approval; if they cancel, say it did not happen and do not retry or route around it.",
  inputSchema: personUpdateTargetSchema,
  async execute(input, ctx) {
    const outcome = await withModelSafeStoreErrors(() =>
      undoPersonUpdate({ ...input, ownerUserId: resolveOwnerUserId(ctx) }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    return outcome.result;
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        status: output.status,
        rendered: "The profile undo outcome is shown to the owner.",
        guidance:
          "Confirm briefly. Only applied means a restoration ran now; already_undone is a retry receipt, and superseded or unavailable means nothing was restored.",
      },
    };
  },
});
