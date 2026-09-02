/**
 * The parts of eve 0.47.7's tool-approval protocol this repository has to know
 * by value, verified against `node_modules/eve/dist`.
 *
 * A policy cannot author any of this. eve builds the whole `InputRequest` from
 * the tool call itself (`harness/input-extraction.js`) — including its prompt,
 * fixed at `Approve tool call: <name>`, because `ApprovalStatus` types
 * `user-approval`'s `reason` as `never`. What the approver judges is therefore
 * the frozen tool input on the same request, never text a policy wrote. The
 * constants below are the framework's, kept here because the eval harness that
 * answers a parked request and the tests that assert one both have to agree
 * with them by value.
 */

/** `kind` on the `input.requested` entry that a parked tool call produces. */
export const APPROVAL_REQUEST_KIND = "tool-approval";

/**
 * The option id an owner returns to let the parked call run.
 *
 * eve emits two, in this order: `approve`, then the decline — which it names
 * `cancel`, not `decline`. Only the approving id is named here, because it is
 * the only one this side of the repository sends: the eval harness plays the
 * owner who says yes, and the web card owns its own rendering of both.
 */
export const APPROVAL_APPROVE_OPTION_ID = "approve";

/**
 * The one reason every denial gives, whatever the cause.
 *
 * ADR-0219: a denial must not tell a caller which check it failed, because the
 * difference between "that record is not yours" and "that record does not
 * exist" is itself a disclosure. The wording is aimed at the model, which is
 * the only reader — the AI SDK surfaces a denied reason on the approval
 * response — and its job is to stop the retry loop a bare refusal invites.
 */
export const OPAQUE_DENIAL =
  "Not available in this session. Do not retry it, rephrase it, or report it as done: " +
  "tell the user this has to be done in the Tendnote web app.";
