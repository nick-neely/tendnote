import { z } from "zod";
import { getGeneralAction } from "../general-actions";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject, whenText } from "./define";

const actionRef = z.object({ generalActionId: z.uuid() });

const statusChange = actionRef.extend({
  action: z.enum(["complete", "defer", "dismiss", "reopen", "archive", "pause", "resume"]),
  deferUntil: z.string().optional(),
});

const contentEdit = actionRef.extend({
  title: z.string().optional(),
  notes: z.string().nullish(),
  dueAt: z.string().nullish(),
});

/**
 * The action this caller may act on.
 *
 * Not narrowed to the owner: a household or selected-shared Action is actionable
 * by any member who can see it (ADR 0153), so the read seam's own visibility is
 * the right boundary here and the shared lifecycle still refuses the rest.
 */
function visibleAction(input: { generalActionId: string }, callerUserId: string) {
  return getGeneralAction({
    actorUserId: callerUserId,
    generalActionId: input.generalActionId,
  });
}

const ACTION_TITLES: Record<z.infer<typeof statusChange>["action"], string> = {
  archive: "Archive an action",
  complete: "Mark an action done",
  defer: "Push an action out",
  dismiss: "Dismiss an action",
  pause: "Pause a routine",
  reopen: "Reopen an action",
  resume: "Resume a routine",
};

export const generalActionApprovalSubjects: ApprovalSubjectDescribers = {
  accept_suggested_general_action: defineSubject({
    schema: actionRef.extend({
      edit: z
        .object({
          title: z.string().optional(),
          notes: z.string().nullish(),
          dueAt: z.string().nullish(),
        })
        .optional(),
    }),
    load: visibleAction,
    describe: (action, input) =>
      subject("Put a suggested action on the active list", [
        detail("Action", action.title),
        detail("Due", whenText(action.dueAt)),
        detail("Retitled to", input.edit?.title),
        detail("New date", whenText(input.edit?.dueAt)),
      ]),
  }),

  dismiss_suggested_general_action: defineSubject({
    schema: actionRef,
    load: visibleAction,
    describe: (action) => subject("Dismiss a suggested action", [detail("Action", action.title)]),
  }),

  edit_general_action: defineSubject({
    schema: contentEdit,
    load: visibleAction,
    describe: (action, input) =>
      subject(`Edit the action "${action.title}"`, [
        detail("Currently due", whenText(action.dueAt)),
        detail("New title", input.title),
        detail("New notes", input.notes ?? (input.notes === null ? "(cleared)" : undefined)),
        detail("New date", input.dueAt === null ? "(unscheduled)" : whenText(input.dueAt)),
      ]),
  }),

  update_general_action_status: defineSubject({
    schema: statusChange,
    load: visibleAction,
    describe: (action, input) =>
      subject(ACTION_TITLES[input.action], [
        detail("Action", action.title),
        detail("Due", whenText(action.dueAt)),
        detail("Comes back", whenText(input.deferUntil)),
      ]),
  }),
};
