"use server";

import { setEveApprovalMode } from "@tendnote/db/queries/access-profiles";
import {
  recordEveSessionToolTrust,
  recordEveSessionToolTrustInputSchema,
} from "@tendnote/db/queries/eve-session-tool-trusts";
import { type EveApprovalMode, eveApprovalModeSchema } from "@tendnote/domain";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * The two owner-scoped writes behind Eve's Approval Mode: the account-level
 * choice, and the per-conversation Session Tool Trust an approval card records.
 *
 * Neither takes a subject. The Approval Mode is the signed-in user's own setting
 * and a Session Tool Trust is their own choice about their own conversation, so
 * in both cases the owner comes from `runOwnerAction`'s admission gate and never
 * from the request. An argument naming whose approvals to change would be the one
 * shape that turns a personal safety setting into something another account could
 * reach.
 */

const setEveApprovalModeSchema = z.object({ mode: eveApprovalModeSchema });

/**
 * Choose how Eve's gated tool calls are authorized for this account.
 *
 * No affected scopes. Everything downstream of the choice reads it fresh: the
 * agent's policy reads the mode from the database on every gated call, and the
 * account page and the assistant surfaces read it per request. There is no cached
 * owner collection holding a copy of it, so naming one here would reconcile a
 * scope for nothing.
 *
 * The mode the caller supplies is parsed against the domain enum, which is the
 * whole of the validation: two values, and anything else is not a mode.
 */
export async function setEveApprovalModeAction(input: { mode: EveApprovalMode }) {
  return runOwnerAction({
    schema: setEveApprovalModeSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const mode = await setEveApprovalMode({ userId: ownerUserId, mode: parsed.mode });
      return { mode };
    },
    result: ({ mode }) => ({ mode }),
  });
}

/**
 * Remember, for the rest of one conversation, that a named tool need not ask
 * again before a Reversible Private Write.
 *
 * The session id travels from the browser because that is where the live
 * conversation is known, and a session id is an identifier rather than an
 * authorization (ADR 0238). What makes that safe is the query underneath: it
 * writes only through the session-owner binding, so a session belonging to
 * somebody else and a session that never existed both write nothing and both
 * answer `recorded: false`. The caller learns only that nothing was recorded,
 * which is what keeps this from being an existence oracle for another account's
 * conversations (ADR 0219).
 *
 * A `false` is therefore silent at the surface: it happens after an approval the
 * owner already gave and already saw take effect, so the only thing lost is the
 * convenience of not being asked again.
 */
const recordSessionToolTrustSchema = recordEveSessionToolTrustInputSchema.omit({
  ownerUserId: true,
});

export async function recordSessionToolTrustAction(input: { sessionId: string; toolName: string }) {
  return runOwnerAction({
    schema: recordSessionToolTrustSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      recordEveSessionToolTrust({
        ownerUserId,
        sessionId: parsed.sessionId,
        toolName: parsed.toolName,
      }),
    result: ({ recorded }) => ({ recorded }),
  });
}
