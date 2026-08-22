/**
 * Exact one-line confirmations for model-facing direct-intent seams.
 *
 * The authored skills repeat these strings because they are the instructions the
 * model reads. Evaluators import these values so a wording change cannot silently
 * make the production contract and deterministic assertion disagree.
 */
export const DRAFT_REVISION_REPLY_CANONICAL = {
  draft:
    "Updated the internal Tendnote draft; it remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft.",
  approved:
    "Updated the internal Tendnote draft; its prior approval no longer covers this wording, nothing was exported or sent, and it is not an external or Gmail draft.",
} as const;

export const UNFILED_ACTION_REPLY_CANONICAL = "Added the Action unfiled; no Area was assigned.";

export const GIFT_PLAN_EMPTY_REPLY_CANONICAL = "No matching Gift Plans are showing.";
