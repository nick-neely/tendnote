import { createTendnoteAuth } from "@tendnote/auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkFirstValuePath } from "./first-value-check";
import { MARKETING_URL } from "./public-links";

/**
 * The First Value check's session cleanup against Better Auth's own handler
 * (#746), rather than a fake that answers 200 whatever it is sent.
 */

const APP = "https://app.example.test";
const EMAIL = "synthetic-check@example.test";
const PASSWORD = "synthetic-secret-password";
const ENV = {
  BETTER_AUTH_URL: APP,
  BETTER_AUTH_SECRET: "s".repeat(32),
  TENDNOTE_SYNTHETIC_CHECK_EMAIL: EMAIL,
  TENDNOTE_SYNTHETIC_CHECK_PASSWORD: PASSWORD,
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  STRIPE_PRICE_MONTHLY: "price_monthly",
  STRIPE_PRICE_ANNUAL: "price_annual",
};

async function createAuthWithSyntheticAccount() {
  const auth = createTendnoteAuth(
    {
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
    },
    { BETTER_AUTH_URL: APP, BETTER_AUTH_SECRET: ENV.BETTER_AUTH_SECRET },
  );
  await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: "Synthetic check" },
  });
  return auth;
}

type Auth = Awaited<ReturnType<typeof createAuthWithSyntheticAccount>>;

function activeSession(auth: Auth, cookie: string) {
  return auth.api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true },
  });
}

/**
 * Hands an auth request to Better Auth as a Next.js route does: a POST arrives
 * with a body stream even when the caller sent no body, so the handler checks
 * its media type. A bare `new Request` would skip that check. Every auth
 * request the check makes is a POST.
 */
function throughNextRoute(auth: Auth, url: string, init: RequestInit = {}) {
  const emptyBody = new ReadableStream({ start: (controller) => controller.close() });
  return auth.handler(
    new Request(url, { ...init, body: init.body ?? emptyBody, duplex: "half" } as RequestInit),
  );
}

/** Eve's inspection route, which admits only a live session. */
async function eveInfo(auth: Auth, init: RequestInit = {}) {
  const session = await activeSession(auth, new Headers(init.headers).get("cookie") ?? "");
  return session
    ? Response.json({ agent: { model: { id: "google/eve-model" } } })
    : new Response(null, { status: 401 });
}

/** A deployment whose auth is Better Auth's own handler; the landing page is up. */
function deployment(auth: Auth) {
  const routes: Record<string, (init?: RequestInit) => Promise<Response>> = {
    [MARKETING_URL]: async () => new Response(null, { status: 200 }),
    [`${APP}/eve/v1/info`]: (init) => eveInfo(auth, init),
  };
  const requests: { url: string; init?: RequestInit; status: number }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const response = await (routes[url]?.(init) ?? throughNextRoute(auth, url, init));
    requests.push({ url, init, status: response.status });
    return response;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

describe("First Value check sign-out against Better Auth", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a sign-out with no JSON media type, as production did", async () => {
    const auth = await createAuthWithSyntheticAccount();
    const response = await deployment(auth).fetch(`${APP}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: APP },
    });
    expect(response.status).toBe(415);
  });

  it("ends the session the check signed in with", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = await createAuthWithSyntheticAccount();
    const { fetch, requests } = deployment(auth);

    await expect(
      checkFirstValuePath({
        env: ENV,
        fetch,
        priceIsActive: async () => true,
        callModel: async () => {},
        claimGroundedAnswer: async () => false,
      }),
    ).resolves.toEqual({ status: "ran", failed: [], groundedAnswer: null });

    const signOut = requests.find((request) => request.url === `${APP}/api/auth/sign-out`);
    expect(signOut?.status).toBe(200);
    const cookie = new Headers(signOut?.init?.headers).get("cookie");
    expect(cookie).toBeTruthy();
    await expect(activeSession(auth, cookie ?? "")).resolves.toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});
