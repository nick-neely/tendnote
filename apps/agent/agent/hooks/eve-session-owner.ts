import { bindEveSessionOwner } from "@tendnote/db/queries/eve-session-owners";
import { defineHook } from "eve/hooks";

/**
 * Writes the authoritative session -> owner binding the channel guard enforces.
 *
 * `session.started` fires once, after Eve has durably recorded the new session,
 * and carries the initiator on `ctx.session.auth.initiator` — the caller who
 * created the session. That is exactly the owner the follow-up/stream/control
 * routes must be scoped to.
 *
 * Only human (`principalType: "user"`) sessions are bound. Scheduled, system,
 * and subagent sessions carry a non-user initiator (or none) and are never
 * reachable through the authenticated web attach routes, so they intentionally
 * get no owner row: any web caller presenting such a session id is a mismatch
 * and is opaquely rejected, which is the correct outcome.
 *
 * The write is awaited so the binding lands promptly (shrinking the window in
 * which the owner's own just-created session would 404 and reconnect), but a
 * failure is swallowed: hooks are observe-only and the durable event is already
 * recorded. A dropped write leaves that one session inaccessible until the owner
 * starts a new one — the fail-closed trade we accept over leaking cross-user
 * access.
 */
export const createEveSessionOwnerHook = (bind: typeof bindEveSessionOwner = bindEveSessionOwner) =>
  defineHook({
    events: {
      async "session.started"(_event, ctx) {
        const initiator = ctx.session.auth.initiator;
        if (initiator?.principalType !== "user") return;

        try {
          await bind({ sessionId: ctx.session.id, ownerUserId: initiator.principalId });
        } catch {
          // Best-effort: the session's durable event is recorded regardless.
        }
      },
    },
  });

export default createEveSessionOwnerHook();
