import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { account } from "../schema/auth";

/**
 * Resolves the Better Auth `account.id` (row id) for one owner's linked
 * provider, or null when the owner has no such linked account.
 *
 * Better Auth 1.7 replaced provider-based account selection on
 * `/get-access-token` with an explicit account row id, so every non-request
 * token caller must name exactly one account. This reads only the row's
 * identity: token custody, decryption, and refresh stay inside Better Auth
 * (ADR-0071), and no token column is selected here.
 */
export type BetterAuthAccountIdResolver = (ref: {
  ownerUserId: string;
  providerId: string;
}) => Promise<string | null>;

/**
 * Drizzle-backed resolver used by the non-request (agent, brief, Today) paths.
 *
 * Ordered because an owner can hold more than one account row per provider:
 * Better Auth keys a link by its provider-side account id, so linking a *second*
 * Google account adds a row rather than replacing the first, and
 * `accountLinking.allowDifferentEmails` permits exactly that. An unordered
 * `limit(1)` would then pick whichever row Postgres happened to return, and
 * because Better Auth rewrites the row on every token refresh, that answer can
 * change between two reads for the same owner — silently alternating which
 * calendar Eve reports on.
 *
 * The oldest link wins: it is the account the owner connected the capability
 * with. Selecting the *right* row for a second link is a Provider Connection
 * modelling question (nothing today records which account backs a capability),
 * so this only guarantees a stable answer, not a chosen one.
 */
export const findBetterAuthAccountId: BetterAuthAccountIdResolver = async ({
  ownerUserId,
  providerId,
}) => {
  const rows = await getDb()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, ownerUserId), eq(account.providerId, providerId)))
    // `id` breaks a `createdAt` tie so the answer is total, not merely narrowed.
    .orderBy(asc(account.createdAt), asc(account.id))
    .limit(1);

  return rows[0]?.id ?? null;
};
