import type { HouseholdInvitationState } from "@tendnote/domain/household-invitations";

/**
 * The one retry message every household surface shows for a failure it cannot
 * explain. Shared rather than copied so the promise it makes — *nothing changed*
 * — is a single sentence that can be corrected in one place if it ever stops
 * being true.
 */
export const HOUSEHOLD_GENERIC_ERROR =
  "That didn't go through. Nothing changed, so you can try again.";

/**
 * One date format for every invitation deadline, on both sides of the flow.
 *
 * The Owner and the recipient are reading about the same moment, so they read it
 * the same way. `Aug 22` rather than a full date: this is a deadline someone
 * glances at, not a record, and the year is never in question inside a 14-day
 * window.
 */
export const INVITATION_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * What an invitation's state says to the Owner who sent it.
 *
 * Written per state rather than derived, and deliberately plain: an invitation
 * that was declined or ran out is information, not a failure, and nothing here
 * should read as though the Owner or the recipient did something wrong. Each
 * line describes the invitation, never the person — "Declined", not "Sam said
 * no" — because the Owner is entitled to their own invitation's state and to
 * nothing else about the recipient.
 */
export const INVITATION_STATE_LABEL: Record<HouseholdInvitationState, string> = {
  pending: "Invited",
  accepted: "Joined",
  declined: "Declined",
  canceled: "Cancelled",
  expired: "Ran out",
};
