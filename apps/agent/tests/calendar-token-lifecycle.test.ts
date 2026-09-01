import {
  CalendarAuthorizationError,
  createBetterAuthGoogleCalendarAccessTokenProvider,
  createDefaultGoogleCalendarReader,
  createInMemoryCalendarCacheStore,
  isGoogleCalendarReauthorizationFailure,
  readConnectedOwnerCalendar,
} from "@tendnote/db/queries/calendar";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCalendarRead } from "../agent/lib/calendar-read";

const SECRET = "calendar-lifecycle-fixture-secret-0123456789";
const SECRET_CONFIG = { keys: new Map([[1, SECRET]]), currentVersion: 1 };
const WRONG_SECRET_CONFIG = {
  keys: new Map([[1, "different-calendar-fixture-secret-0123456789"]]),
  currentVersion: 1,
};
const NOW = new Date("2026-06-30T12:00:00.000Z");
const REQUEST = {
  providerKey: "google",
  capabilityKey: "calendar",
  timeMin: new Date("2026-06-29T00:00:00.000Z"),
  timeMax: new Date("2026-07-06T00:00:00.000Z"),
};

type FixtureAccount = {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scope: string;
  idToken: null;
  password: null;
  createdAt: Date;
  updatedAt: Date;
};

type Fixture = {
  auth: {
    api: {
      getAccessToken: (input: {
        body: { accountId: string; userId: string };
      }) => Promise<{ accessToken: string; accessTokenExpiresAt?: Date }>;
    };
  };
  accounts: FixtureAccount[];
  refreshes: string[];
};

type FixtureOptions = {
  omitOwnerOne?: boolean;
  ownerOneAccessToken?: string;
  ownerOneRefreshToken?: string | null;
  refreshAccessToken?: (refreshToken: string) => Promise<{
    accessToken: string;
    accessTokenExpiresAt: Date;
  }>;
};

async function encrypted(value: string, key: typeof SECRET_CONFIG = SECRET_CONFIG) {
  return symmetricEncrypt({
    key,
    data: value,
  });
}

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const now = new Date();
  const accounts: FixtureAccount[] = [];
  const refreshes: string[] = [];

  for (const ownerUserId of options.omitOwnerOne ? ["owner-2"] : ["owner-1", "owner-2"]) {
    accounts.push({
      id: `account-${ownerUserId}`,
      userId: ownerUserId,
      accountId: `google-${ownerUserId}`,
      providerId: "google",
      accessToken:
        ownerUserId === "owner-1" && options.ownerOneAccessToken
          ? options.ownerOneAccessToken
          : await encrypted(`expired-access-${ownerUserId}`),
      refreshToken:
        ownerUserId === "owner-1" && options.ownerOneRefreshToken !== undefined
          ? options.ownerOneRefreshToken
          : await encrypted(`refresh-${ownerUserId}`),
      accessTokenExpiresAt: new Date(now.getTime() - 60_000),
      refreshTokenExpiresAt: null,
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
      idToken: null,
      password: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Keep an unrelated account for owner-1 to prove the lifecycle call selects
  // the explicitly requested Google account rather than a global first row.
  const users = ["owner-1", "owner-2"].map((id) => ({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  }));
  const database = {
    user: users,
    account: [
      ...accounts,
      ...(accounts[0]
        ? [
            {
              ...accounts[0],
              id: "account-owner-1-github",
              accountId: "github-owner-1",
              providerId: "github",
              accessToken: await encrypted("github-access"),
              refreshToken: await encrypted("github-refresh"),
            },
          ]
        : []),
    ],
    session: [],
    verification: [],
  };

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: SECRET,
    secrets: [{ version: 1, value: SECRET }],
    database: memoryAdapter(database),
    socialProviders: {
      google: {
        clientId: "fixture-client-id",
        clientSecret: "fixture-client-secret",
        refreshAccessToken:
          options.refreshAccessToken ??
          (async (refreshToken: string) => {
            refreshes.push(refreshToken);
            const ownerUserId = refreshToken.replace("refresh-", "");
            return {
              accessToken: `refreshed-access-${ownerUserId}`,
              accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
            };
          }),
      },
    },
    account: { encryptOAuthTokens: true },
    rateLimit: { enabled: false },
  });

  return { auth, accounts, refreshes };
}

/**
 * Better Auth 1.7 selects the account by row id, so the boundary resolves the
 * owner's linked Google account first. Mirror that lookup against the fixture's
 * own account rows rather than the live database.
 */
function fixtureAccountIdResolver(fixture: Fixture) {
  return async ({ ownerUserId, providerId }: { ownerUserId: string; providerId: string }) =>
    fixture.accounts.find(
      (candidate) => candidate.userId === ownerUserId && candidate.providerId === providerId,
    )?.id ?? null;
}

function calendarEvent(id: string) {
  return {
    id,
    summary: "Coffee with Maya",
    start: { dateTime: "2026-06-30T15:00:00.000Z" },
    end: { dateTime: "2026-06-30T15:30:00.000Z" },
  };
}

describe("Eve Better Auth Calendar token lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("decrypts, refreshes, persists encrypted credentials, and reads a cache miss", async () => {
    const fixture = await createFixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [calendarEvent("evt-refreshed")] }),
      text: async () => "",
    } as Response);
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountId: fixtureAccountIdResolver(fixture),
      getAccessToken: ({ body }) => fixture.auth.api.getAccessToken({ body }),
    });
    const reader = createDefaultGoogleCalendarReader({
      cacheStore: createInMemoryCalendarCacheStore(),
      getAccessToken,
      now: () => NOW.getTime(),
    });

    const outcome = await readConnectedOwnerCalendar(
      { ...REQUEST, ownerUserId: "owner-1" },
      { reader, isConnected: async () => true },
    );

    expect(outcome).toMatchObject({ connected: true, result: { source: "live", stale: false } });
    expect(outcome.result?.events[0]?.providerEventId).toBe("evt-refreshed");
    expect(fixture.refreshes).toEqual(["refresh-owner-1"]);
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Bearer refreshed-access-owner-1",
    });

    const ownerAccount = fixture.accounts[0];
    if (!ownerAccount) throw new Error("fixture is missing owner-1's Google account");
    if (!ownerAccount.refreshToken) throw new Error("fixture is missing the refresh token");
    expect(ownerAccount.accessToken).toMatch(/^\$ba\$1\$/);
    expect(ownerAccount.refreshToken).toMatch(/^\$ba\$1\$/);
    await expect(
      symmetricDecrypt({ key: SECRET_CONFIG, data: ownerAccount.accessToken }),
    ).resolves.toBe("refreshed-access-owner-1");
    await expect(
      symmetricDecrypt({ key: SECRET_CONFIG, data: ownerAccount.refreshToken }),
    ).resolves.toBe("refresh-owner-1");
  });

  it("drives Eve's bounded read through the connected gate and shared lifecycle", async () => {
    const fixture = await createFixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [calendarEvent("evt-bounded")] }),
      text: async () => "",
    } as Response);
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountId: fixtureAccountIdResolver(fixture),
      getAccessToken: ({ body }) => fixture.auth.api.getAccessToken({ body }),
    });
    const reader = createDefaultGoogleCalendarReader({
      cacheStore: createInMemoryCalendarCacheStore(),
      getAccessToken,
      now: () => NOW.getTime(),
    });
    const gateCalls: Array<{
      ownerUserId: string;
      providerKey: string;
      capabilityKey: string;
    }> = [];
    const result = await runCalendarRead(
      {
        ownerUserId: "owner-1",
        input: { daysAhead: 3, daysBack: 2, query: "Maya", limit: 7 },
        now: NOW,
      },
      {
        read: (request) =>
          readConnectedOwnerCalendar(request, {
            reader,
            isConnected: async (ref) => {
              gateCalls.push(ref);
              return ref.ownerUserId === "owner-1";
            },
          }),
      },
    );

    expect(result).toMatchObject({
      status: "ok",
      source: "google_calendar",
      readOnly: true,
      stale: false,
      events: [{ title: "Coffee with Maya" }],
    });
    expect(gateCalls).toEqual([
      { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" },
    ]);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("timeMin")).toBe(
      new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(requestUrl.searchParams.get("timeMax")).toBe(
      new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(requestUrl.searchParams.get("maxResults")).toBe("7");
    expect(requestUrl.searchParams.get("q")).toBe("Maya");

    const disconnected = await runCalendarRead(
      {
        ownerUserId: "owner-2",
        input: { daysAhead: 3, daysBack: 2, query: "Maya", limit: 7 },
        now: NOW,
      },
      {
        read: (request) =>
          readConnectedOwnerCalendar(request, {
            reader,
            isConnected: async (ref) => {
              gateCalls.push(ref);
              return ref.ownerUserId === "owner-1";
            },
          }),
      },
    );
    expect(disconnected).toMatchObject({ status: "not_connected", events: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(gateCalls.at(-1)).toEqual({
      ownerUserId: "owner-2",
      providerKey: "google",
      capabilityKey: "calendar",
    });
  });

  it("isolates owner selection across one Google account per owner", async () => {
    const fixture = await createFixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      text: async () => "",
    } as Response);
    const getAccessToken = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountId: fixtureAccountIdResolver(fixture),
      getAccessToken: ({ body }) => fixture.auth.api.getAccessToken({ body }),
    });

    for (const ownerUserId of ["owner-1", "owner-2"]) {
      const reader = createDefaultGoogleCalendarReader({
        cacheStore: createInMemoryCalendarCacheStore(),
        getAccessToken,
        now: () => NOW.getTime(),
      });
      await expect(
        readConnectedOwnerCalendar(
          { ...REQUEST, ownerUserId },
          { reader, isConnected: async () => true },
        ),
      ).resolves.toMatchObject({ connected: true, result: { source: "live" } });
    }

    expect(fixture.refreshes).toEqual(["refresh-owner-1", "refresh-owner-2"]);
    expect(fetchSpy.mock.calls.map((call) => call[1]?.headers)).toEqual([
      { authorization: "Bearer refreshed-access-owner-1" },
      { authorization: "Bearer refreshed-access-owner-2" },
    ]);
  });

  it("documents Better Auth's truthful error boundary for token lifecycle failures", async () => {
    const missing = await createFixture({ omitOwnerOne: true });
    const missingProvider = createBetterAuthGoogleCalendarAccessTokenProvider({
      findAccountId: fixtureAccountIdResolver(missing),
      getAccessToken: ({ body }) => missing.auth.api.getAccessToken({ body }),
    });
    const missingRawError = await missing.auth.api
      .getAccessToken({ body: { accountId: "account-owner-1", userId: "owner-1" } })
      .catch((error: unknown) => error);
    const missingBoundaryError = await missingProvider({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "calendar",
    }).catch((error: unknown) => error);

    expect(missingRawError).toMatchObject({ body: { code: "ACCOUNT_NOT_FOUND" } });
    expect(isGoogleCalendarReauthorizationFailure(missingRawError)).toBe(true);
    expect(missingBoundaryError).toBeInstanceOf(CalendarAuthorizationError);

    const undecryptable = await createFixture({
      ownerOneAccessToken: await encrypted("expired-access-owner-1", WRONG_SECRET_CONFIG),
      ownerOneRefreshToken: null,
    });
    const undecryptableError = await undecryptable.auth.api
      .getAccessToken({ body: { accountId: "account-owner-1", userId: "owner-1" } })
      .catch((error: unknown) => error);
    const boundaryError = (fixture: Fixture) =>
      createBetterAuthGoogleCalendarAccessTokenProvider({
        findAccountId: fixtureAccountIdResolver(fixture),
        getAccessToken: ({ body }) => fixture.auth.api.getAccessToken({ body }),
      })({ ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" }).catch(
        (error: unknown) => error,
      );
    const undecryptableBoundaryError = await boundaryError(undecryptable);

    const invalidRefresh = await createFixture({
      refreshAccessToken: async () => {
        throw { body: { error: "invalid_grant" } };
      },
    });
    const invalidRefreshError = await invalidRefresh.auth.api
      .getAccessToken({ body: { accountId: "account-owner-1", userId: "owner-1" } })
      .catch((error: unknown) => error);
    const invalidRefreshBoundaryError = await boundaryError(invalidRefresh);

    const transientRefresh = await createFixture({
      refreshAccessToken: async () => {
        throw new Error("Google token endpoint timed out");
      },
    });
    const transientRefreshError = await transientRefresh.auth.api
      .getAccessToken({ body: { accountId: "account-owner-1", userId: "owner-1" } })
      .catch((error: unknown) => error);
    const transientRefreshBoundaryError = await boundaryError(transientRefresh);

    for (const error of [
      undecryptableError,
      undecryptableBoundaryError,
      invalidRefreshError,
      invalidRefreshBoundaryError,
      transientRefreshError,
      transientRefreshBoundaryError,
    ]) {
      // Better Auth 1.6.20 intentionally masks all three causes with the same
      // generic response. The boundary cannot truthfully call any one a revoke.
      expect(error).toMatchObject({ body: { code: "FAILED_TO_GET_ACCESS_TOKEN" } });
      expect(isGoogleCalendarReauthorizationFailure(error)).toBe(false);
    }
  });
});
