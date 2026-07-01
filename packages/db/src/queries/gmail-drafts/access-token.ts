import { GMAIL_CAPABILITY_KEY, GMAIL_PROVIDER_KEY } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { account } from "../../schema/auth";

export class GoogleGmailAccessTokenUnavailableError extends Error {
  constructor(message = "Google Gmail access token is unavailable.") {
    super(message);
    this.name = "GoogleGmailAccessTokenUnavailableError";
  }
}

export type BetterAuthGoogleAccountToken = {
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
};

/** Resolves an owner's Gmail access token for the `google/gmail` capability. */
export type GoogleGmailAccessTokenProvider = (ref: {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
}) => Promise<string>;

/**
 * Better Auth Google access-token bridge for Gmail draft writes (Phase 2D). Gmail
 * shares the owner's Better Auth Google account with Calendar, so this reads the
 * same custody-owned token; it only serves the `google/gmail` capability so a
 * miswired caller cannot borrow it for another capability. Token custody, refresh,
 * and encryption stay in Better Auth — the token is never mirrored into Tendnote
 * tables, audit rows, or logs.
 */
export function createBetterAuthGoogleGmailAccessTokenProvider(deps: {
  findAccountToken: (input: {
    ownerUserId: string;
    providerId: string;
  }) => Promise<BetterAuthGoogleAccountToken | null>;
  now?: () => Date;
}): GoogleGmailAccessTokenProvider {
  const now = deps.now ?? (() => new Date());

  return async (ref) => {
    if (ref.providerKey !== GMAIL_PROVIDER_KEY || ref.capabilityKey !== GMAIL_CAPABILITY_KEY) {
      throw new GoogleGmailAccessTokenUnavailableError();
    }

    const token = await deps.findAccountToken({
      ownerUserId: ref.ownerUserId,
      providerId: GMAIL_PROVIDER_KEY,
    });

    if (!token?.accessToken) {
      throw new GoogleGmailAccessTokenUnavailableError();
    }

    if (token.accessTokenExpiresAt && token.accessTokenExpiresAt.getTime() <= now().getTime()) {
      throw new GoogleGmailAccessTokenUnavailableError();
    }

    return token.accessToken;
  };
}

/** Reads the owner-linked Google account token from Better Auth's account table. */
export function createDrizzleBetterAuthGoogleGmailAccessTokenProvider(): GoogleGmailAccessTokenProvider {
  return createBetterAuthGoogleGmailAccessTokenProvider({
    findAccountToken: async ({ ownerUserId, providerId }) => {
      const rows = await getDb()
        .select({
          accessToken: account.accessToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
        })
        .from(account)
        .where(and(eq(account.userId, ownerUserId), eq(account.providerId, providerId)))
        .limit(1);

      return rows[0] ?? null;
    },
  });
}
