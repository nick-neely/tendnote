import "server-only";

/**
 * Better Auth 1.7 selects an account by its row id on `getAccessToken`,
 * `refreshToken`, and `unlinkAccount` — naming a provider is no longer enough.
 * Every request-scoped caller therefore resolves the owner's linked account
 * first, and does it through this one seam so the "which row?" rule cannot drift
 * between the account page, the disconnect paths, and the Contacts import.
 *
 * Token custody stays with Better Auth (ADR-0071): this reads only the account
 * listing, never a token column.
 */

/** The subset of a Better Auth linked-account row this module needs. */
type LinkedAccount = {
  readonly id: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly createdAt: Date;
};

/** The subset of the Better Auth server API this module calls. */
type LinkedAccountReader = {
  api: {
    listUserAccounts: (input: {
      headers: Headers;
    }) => Promise<readonly LinkedAccount[] | null | undefined>;
  };
};

/**
 * The Better Auth account row id for one of the owner's linked providers, or
 * null when nothing is linked.
 *
 * `providerAccountId` (the provider-side id, e.g. a Discord snowflake) names
 * exactly one row and is the only unambiguous answer when an owner has linked
 * two accounts for the same provider — which Better Auth allows, since it keys a
 * link by that id and `accountLinking.allowDifferentEmails` is on.
 *
 * Without it the oldest link wins rather than whichever row Better Auth listed
 * first, so a caller that cannot name an account still gets a stable answer
 * instead of one that can move as rows are rewritten on token refresh.
 */
export async function findLinkedAccountRowId(
  auth: LinkedAccountReader,
  requestHeaders: Headers,
  providerId: string,
  providerAccountId?: string,
): Promise<string | null> {
  const linked = (await auth.api.listUserAccounts({ headers: requestHeaders })) ?? [];
  const exact = providerAccountId
    ? linked.find(
        (account) => account.providerId === providerId && account.accountId === providerAccountId,
      )
    : undefined;
  if (exact) return exact.id;

  const oldest = linked
    .filter((account) => account.providerId === providerId)
    // `id` breaks a `createdAt` tie so the answer is total, not merely narrowed.
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
    )[0];
  return oldest?.id ?? null;
}
