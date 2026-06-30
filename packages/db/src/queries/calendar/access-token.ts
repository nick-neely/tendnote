import { PROVIDER_GOOGLE } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { account } from "../../schema/auth";
import type { CalendarConnectionRef } from "./types";

const CALENDAR_CAPABILITY = "calendar";

export class GoogleCalendarAccessTokenUnavailableError extends Error {
  constructor(message = "Google Calendar access token is unavailable.") {
    super(message);
    this.name = "GoogleCalendarAccessTokenUnavailableError";
  }
}

export type BetterAuthGoogleAccountToken = {
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
};

export type GoogleCalendarAccessTokenProvider = (ref: CalendarConnectionRef) => Promise<string>;

export function createBetterAuthGoogleCalendarAccessTokenProvider(deps: {
  findAccountToken: (input: {
    ownerUserId: string;
    providerId: string;
  }) => Promise<BetterAuthGoogleAccountToken | null>;
  now?: () => Date;
}): GoogleCalendarAccessTokenProvider {
  const now = deps.now ?? (() => new Date());

  return async (ref) => {
    if (ref.providerKey !== PROVIDER_GOOGLE || ref.capabilityKey !== CALENDAR_CAPABILITY) {
      throw new GoogleCalendarAccessTokenUnavailableError();
    }

    const token = await deps.findAccountToken({
      ownerUserId: ref.ownerUserId,
      providerId: PROVIDER_GOOGLE,
    });

    if (!token?.accessToken) {
      throw new GoogleCalendarAccessTokenUnavailableError();
    }

    if (token.accessTokenExpiresAt && token.accessTokenExpiresAt.getTime() <= now().getTime()) {
      throw new GoogleCalendarAccessTokenUnavailableError();
    }

    return token.accessToken;
  };
}

/**
 * Reads the owner-linked Google account token from Better Auth's account table.
 * This is a token access bridge only: it does not mirror tokens into Tendnote
 * product tables, audit rows, logs, or Calendar cache entries.
 */
export function createDrizzleBetterAuthGoogleCalendarAccessTokenProvider(): GoogleCalendarAccessTokenProvider {
  return createBetterAuthGoogleCalendarAccessTokenProvider({
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
