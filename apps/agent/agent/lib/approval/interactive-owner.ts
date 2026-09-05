import type { ApprovalContext } from "eve/tools/approval";
import { resolveSessionEveMode } from "../eve-modes";

/**
 * The owner who can actually be asked, or `null`.
 *
 * ## Why this is one function and not two
 *
 * It answers the question both halves of the approval feature ask: the policy,
 * deciding whether a gated call may park rather than be denied opaquely, and the
 * dynamic approval-posture instruction, deciding whether this turn has a posture
 * worth stating at all. Those have to agree. An instruction written against a
 * looser caller check would tell a `discord_capture` or `scheduled_workflow`
 * session that its reversible private saves run immediately, when in fact the
 * policy denies every gated call it makes.
 *
 * ## What it checks
 *
 * A directly authenticated human principal, on a session of its own, in the one
 * mode where a client can render and answer an approval request.
 * `resolveSessionEveMode` is the repository's one trusted-signal reader: it takes
 * only what the channel's own `AuthFn` stamped, never message text or anything
 * the browser supplied. Every other mode either has nobody watching
 * (`scheduled_workflow`, which runs as `eve:app`) or no way to answer
 * (`discord_capture`, whose route never starts a model session at all).
 *
 * Read defensively all the way down: a context that arrives without a session is
 * exactly the shape this must not throw on, because the policy that calls it may
 * not throw either.
 */
export function interactiveOwnerUserId(ctx: unknown): string | null {
  const current = (ctx as ApprovalContext | undefined)?.session?.auth?.current;
  if (!current) return null;

  const ownerUserId = current.principalId?.trim();
  if (!ownerUserId) return null;

  // A subagent turn. Subagents propose; the parent session is where a person is.
  if ((ctx as ApprovalContext).session?.parent !== undefined) return null;

  if (resolveSessionEveMode(current) !== "web_chat") return null;

  return ownerUserId;
}
