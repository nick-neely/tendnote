import { eq } from "drizzle-orm";
import { getDb } from "../client";
import { eveSessionOwners } from "../schema";

/**
 * Persist the authoritative owner of a newly created Eve session.
 *
 * Idempotent: the initiator is fixed at creation and a session id never changes
 * owner, so a repeated `session.started` (or a retried write) keeps the first
 * binding rather than overwriting it. Callers invoke this from the session
 * lifecycle hook and swallow failures — the durable Eve event is already
 * recorded regardless.
 */
export async function bindEveSessionOwner(input: {
  sessionId: string;
  ownerUserId: string;
}): Promise<void> {
  await getDb()
    .insert(eveSessionOwners)
    .values({ sessionId: input.sessionId, ownerUserId: input.ownerUserId })
    .onConflictDoNothing({ target: eveSessionOwners.sessionId });
}

/**
 * Resolve the owner bound to an Eve session id, or `null` when no binding
 * exists. `null` is treated by the channel guard as "not the caller's session"
 * (an opaque not-found), never as an allow.
 */
export async function getEveSessionOwnerUserId(sessionId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ ownerUserId: eveSessionOwners.ownerUserId })
    .from(eveSessionOwners)
    .where(eq(eveSessionOwners.sessionId, sessionId))
    .limit(1);

  return row?.ownerUserId ?? null;
}
