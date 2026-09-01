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
 * `providerAccountId` (the provider-side id, e.g. a Discord snowflake)
 * disambiguates when more than one account for the same provider could be
 * linked; without it the owner's first account for that provider wins.
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
  return (exact ?? linked.find((account) => account.providerId === providerId))?.id ?? null;
}
