import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkFirstValuePath,
  claimDailyGroundedAnswer,
  FIRST_VALUE_FIXTURE,
} from "./first-value-check";
import { MARKETING_URL } from "./public-links";

const APP = "https://app.example.test";
const EMAIL = "synthetic-check@example.test";
const PASSWORD = "synthetic-secret-password";
const ENV = {
  BETTER_AUTH_URL: APP,
  TENDNOTE_SYNTHETIC_CHECK_EMAIL: EMAIL,
  TENDNOTE_SYNTHETIC_CHECK_PASSWORD: PASSWORD,
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  STRIPE_PRICE_MONTHLY: "price_monthly",
  STRIPE_PRICE_ANNUAL: "price_annual",
};

type Route = { status: number; body?: unknown; cookies?: string[] };

/** A fake network: each URL answers as configured, and every request is recorded. */
function fakeNetwork(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [MARKETING_URL]: { status: 200 },
    [`${APP}/api/auth/sign-in/email`]: {
      status: 200,
      body: { user: { id: "synthetic-user" } },
      cookies: [
        "tendnote.session_token=abc; Path=/; HttpOnly",
        "tendnote.session_data=xyz; Path=/",
      ],
    },
    [`${APP}/eve/v1/info`]: { status: 200, body: { agent: { model: { id: "google/eve-model" } } } },
    [`${APP}/api/auth/sign-out`]: { status: 200 },
    ...overrides,
  };
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError(`unexpected request to ${url}`);
    const headers = new Headers();
    for (const cookie of route.cookies ?? []) headers.append("set-cookie", cookie);
    return new Response(route.body ? JSON.stringify(route.body) : null, {
      status: route.status,
      headers,
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests, urls: () => requests.map((request) => request.url) };
}

function check(
  options: Partial<Parameters<typeof checkFirstValuePath>[0]> & { network?: Record<string, Route> },
) {
  const network = fakeNetwork(options.network);
  const pingModel = vi.fn(async (_input: { accountId: string; modelId: string }) => {});
  const askEve = vi.fn(
    async (_input: { appUrl: string; cookie: string; question: string }) => "Lapsang souchong.",
  );
  const priceIsActive = vi.fn(async (_input: { secretKey: string; priceId: string }) => true);
  const run = checkFirstValuePath({
    env: ENV,
    fetch: network.fetch,
    pingModel,
    askEve,
    priceIsActive,
    ...options,
  });
  return { run, network, pingModel, askEve, priceIsActive };
}

describe("checkFirstValuePath", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is off without the synthetic account's credentials or outside hosted mode", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    for (const env of [
      { ...ENV, TENDNOTE_SYNTHETIC_CHECK_EMAIL: undefined },
      { ...ENV, TENDNOTE_SYNTHETIC_CHECK_PASSWORD: undefined },
      {
        ...ENV,
        TENDNOTE_ADMISSION_MODE: "self-hosted",
        TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.test",
      },
    ]) {
      await expect(checkFirstValuePath({ env, fetch })).resolves.toEqual({ status: "off" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("walks the cheap path as the synthetic account and signs out, without asking Eve", async () => {
    const { run, network, pingModel, askEve, priceIsActive } = check({
      claimGroundedAnswer: async () => false,
    });
    await expect(run).resolves.toEqual({ status: "ran", failed: [], groundedAnswer: null });

    expect(priceIsActive.mock.calls.map(([input]) => input)).toEqual([
      { secretKey: "sk_test_synthetic", priceId: "price_monthly" },
      { secretKey: "sk_test_synthetic", priceId: "price_annual" },
    ]);
    const signIn = network.requests.find((request) => request.url.endsWith("/sign-in/email"));
    expect(JSON.parse(String(signIn?.init?.body))).toEqual({ email: EMAIL, password: PASSWORD });
    expect(new Headers(signIn?.init?.headers).get("origin")).toBe(APP);
    const info = network.requests.find((request) => request.url.endsWith("/eve/v1/info"));
    expect(new Headers(info?.init?.headers).get("cookie")).toBe(
      "tendnote.session_token=abc; tendnote.session_data=xyz",
    );
    expect(pingModel).toHaveBeenCalledWith({
      accountId: "synthetic-user",
      modelId: "google/eve-model",
    });
    expect(askEve).not.toHaveBeenCalled();
    expect(network.urls().at(-1)).toBe(`${APP}/api/auth/sign-out`);
  });

  it("asks Eve the fixture question when told to, and passes only on the grounded answer", async () => {
    const grounded = check({ claimGroundedAnswer: async () => true });
    await expect(grounded.run).resolves.toEqual({
      status: "ran",
      failed: [],
      groundedAnswer: true,
    });
    expect(grounded.askEve).toHaveBeenCalledWith({
      appUrl: APP,
      cookie: "tendnote.session_token=abc; tendnote.session_data=xyz",
      question: FIRST_VALUE_FIXTURE.question,
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const ungrounded = check({
      claimGroundedAnswer: async () => true,
      askEve: vi.fn(async () => "I don't have anything saved about Marlow."),
    });
    await expect(ungrounded.run).resolves.toEqual({
      status: "ran",
      failed: [],
      groundedAnswer: false,
    });
    expect(ungrounded.network.urls().at(-1)).toBe(`${APP}/api/auth/sign-out`);
  });

  it("reports every cheap step that fails and logs only the step", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = check({
      network: { [MARKETING_URL]: { status: 503 } },
      priceIsActive: vi.fn(async ({ priceId }) => priceId !== "price_annual"),
      pingModel: vi.fn(async () => {
        throw new TypeError("gateway unavailable");
      }),
    });
    await expect(run).resolves.toEqual({
      status: "ran",
      failed: ["landing", "checkout", "model"],
      groundedAnswer: null,
    });
    expect(error.mock.calls).toEqual([
      ["first_value_check.failed", { step: "landing", reason: "unexpected_result" }],
      ["first_value_check.failed", { step: "checkout", reason: "unexpected_result" }],
      ["first_value_check.failed", { step: "model", reason: "TypeError" }],
    ]);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/synthetic-check|secret-password/);
  });

  it("fails checkout when Stripe is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, priceIsActive } = check({ env: { ...ENV, STRIPE_PRICE_ANNUAL: undefined } });
    await expect(run).resolves.toMatchObject({ failed: ["checkout"] });
    expect(priceIsActive).not.toHaveBeenCalled();
  });

  it("stops at a failed sign-in, giving no grounded reading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const claimGroundedAnswer = vi.fn(async () => true);
    const { run, network, pingModel, askEve } = check({
      claimGroundedAnswer,
      network: { [`${APP}/api/auth/sign-in/email`]: { status: 401 } },
    });
    await expect(run).resolves.toEqual({
      status: "ran",
      failed: ["sign_in"],
      groundedAnswer: null,
    });
    expect(pingModel).not.toHaveBeenCalled();
    expect(askEve).not.toHaveBeenCalled();
    expect(claimGroundedAnswer).not.toHaveBeenCalled();
    expect(network.urls()).not.toContain(`${APP}/eve/v1/info`);
  });

  it("does not claim or ask Eve after it refused the account, and still signs out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const claimGroundedAnswer = vi.fn(async () => true);
    const { run, network, askEve, pingModel } = check({
      claimGroundedAnswer,
      network: { [`${APP}/eve/v1/info`]: { status: 403 } },
    });
    await expect(run).resolves.toEqual({
      status: "ran",
      failed: ["admission", "model"],
      groundedAnswer: null,
    });
    expect(pingModel).not.toHaveBeenCalled();
    expect(claimGroundedAnswer).not.toHaveBeenCalled();
    expect(askEve).not.toHaveBeenCalled();
    expect(network.urls().at(-1)).toBe(`${APP}/api/auth/sign-out`);
  });
});

it("fails the model step when Eve does not name its model", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { run, pingModel } = check({
    network: { [`${APP}/eve/v1/info`]: { status: 200, body: { agent: {} } } },
  });
  await expect(run).resolves.toMatchObject({ failed: ["model"] });
  expect(pingModel).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("claimDailyGroundedAnswer", () => {
  it("lets only the first pass at or after 15:00 UTC claim each UTC day", async () => {
    const claimed = new Set<string>();
    const setOnce = vi.fn(async (key: string, _ttlSeconds: number) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    const at = (iso: string) => claimDailyGroundedAnswer(new Date(iso), setOnce);

    expect(await at("2026-10-04T14:59:59Z")).toBe(false);
    expect(setOnce).not.toHaveBeenCalled();
    // A missed 15:00 pass is made up by a later one, which a third cannot repeat.
    expect(await at("2026-10-04T15:20:00Z")).toBe(true);
    expect(await at("2026-10-04T15:30:00Z")).toBe(false);
    expect(await at("2026-10-04T23:50:00Z")).toBe(false);
    expect(await at("2026-10-05T15:00:00Z")).toBe(true);
    expect(setOnce.mock.calls[0]).toEqual([
      "tendnote:first-value-check:grounded:2026-10-04",
      172_800,
    ]);
  });
});
