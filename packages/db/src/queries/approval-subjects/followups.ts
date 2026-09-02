import { z } from "zod";
import { getFollowup } from "../followups";
import { getPerson } from "../people";
import {
  type ApprovalSubjectDescribers,
  defineSubject,
  detail,
  ownedBy,
  subject,
  whenText,
} from "./define";

const followupRef = z.object({ followupId: z.uuid() });

const statusChange = followupRef.extend({
  status: z.enum(["complete", "dismiss", "snooze", "reopen", "archive"]),
  dueAt: z.string().optional(),
});

const newFollowup = z.object({
  personId: z.uuid(),
  reason: z.string().min(1),
  dueAt: z.string().optional(),
});

/**
 * A follow-up the caller owns, or nothing.
 *
 * The read entry point answers by visibility so a household member can see a
 * shared reminder, but every lifecycle mutation behind these tools is owner-only
 * — so a shared follow-up somebody else owns must not park an approval it could
 * never apply.
 */
async function ownFollowup(input: { followupId: string }, ownerUserId: string) {
  return ownedBy(
    await getFollowup({ actorUserId: ownerUserId, followupId: input.followupId }),
    ownerUserId,
  );
}

const STATUS_TITLES: Record<z.infer<typeof statusChange>["status"], string> = {
  archive: "Archive a follow-up",
  complete: "Mark a follow-up done",
  dismiss: "Dismiss a follow-up",
  reopen: "Reopen a follow-up",
  snooze: "Move a follow-up's date",
};

export const followupApprovalSubjects: ApprovalSubjectDescribers = {
  accept_suggested_followup: defineSubject({
    schema: followupRef.extend({
      edit: z.object({ reason: z.string().optional(), dueAt: z.string().optional() }).optional(),
    }),
    load: ownFollowup,
    describe: (followup, input) =>
      subject("Turn a suggested follow-up into a reminder", [
        detail("Follow up", followup.reason),
        detail("Due", whenText(followup.dueAt)),
        detail("Reworded to", input.edit?.reason),
        detail("New date", whenText(input.edit?.dueAt)),
      ]),
  }),

  create_followup: defineSubject({
    schema: newFollowup,
    load: (input, ownerUserId) => getPerson({ ownerUserId, personId: input.personId }),
    describe: (person, input) =>
      subject(`Create a follow-up reminder for ${person.displayName}`, [
        detail("Follow up", input.reason),
        detail("Due", whenText(input.dueAt)),
      ]),
  }),

  dismiss_suggested_followup: defineSubject({
    schema: followupRef,
    load: ownFollowup,
    describe: (followup) =>
      subject("Dismiss a suggested follow-up", [detail("Follow up", followup.reason)]),
  }),

  update_followup_status: defineSubject({
    schema: statusChange,
    load: ownFollowup,
    describe: (followup, input) =>
      subject(STATUS_TITLES[input.status], [
        detail("Follow up", followup.reason),
        detail("Due", whenText(followup.dueAt)),
        detail("New date", whenText(input.dueAt)),
      ]),
  }),
};
