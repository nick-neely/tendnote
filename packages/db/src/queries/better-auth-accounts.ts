import { and, eq } from "drizzle-orm";
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

/** Drizzle-backed resolver used by the non-request (agent, brief, Today) paths. */
export const findBetterAuthAccountId: BetterAuthAccountIdResolver = async ({
  ownerUserId,
  providerId,
}) => {
  const rows = await getDb()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, ownerUserId), eq(account.providerId, providerId)))
    .limit(1);

  return rows[0]?.id ?? null;
};
