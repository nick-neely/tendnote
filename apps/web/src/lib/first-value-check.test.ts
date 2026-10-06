import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkFirstValuePath,
  claimDailyGroundedAnswer,
  FIRST_VALUE_FIXTURE,
} from "./first-value-check";
import { MARKETING_URL } from "./public-links";

/** What the default call's model does: it never reaches the gateway or pays. */
const gatewayModel = vi.hoisted(() => ({
  doGenerate: async (): Promise<never> => {
    throw new Error("no model call expected");
  },
}));

vi.mock("@tendnote/db/queries/model-calls", () => ({
  hostedModel: () => new MockLanguageModelV4({ doGenerate: () => gatewayModel.doGenerate() }),
}));

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
  const callModel = vi.fn(
    async (_input: { accountId: string; modelId: string; abortSignal: AbortSignal }) => {},
  );
  const askEve = vi.fn(
    async (_input: { appUrl: string; cookie: string; question: string }) => "Lapsang souchong.",
  );
  const priceIsActive = vi.fn(async (_input: { secretKey: string; priceId: string }) => true);
  const run = checkFirstValuePath({
    env: ENV,
    fetch: network.fetch,
    callModel,
    askEve,
    priceIsActive,
    ...options,
  });
  return { run, network, callModel, askEve, priceIsActive };
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
    const { run, network, callModel, askEve, priceIsActive } = check({
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
    expect(callModel).toHaveBeenCalledOnce();
    expect(callModel).toHaveBeenCalledWith({
      accountId: "synthetic-user",
      modelId: "google/eve-model",
      abortSignal: expect.any(AbortSignal),
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
      callModel: vi.fn(async () => {
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
      [
        "first_value_check.failed",
        {
          step: "model",
          reason: "TypeError",
          elapsedMs: expect.any(Number),
          attempts: [
            {
              outcome: "failed",
              elapsedMs: expect.any(Number),
              error: "TypeError",
              retryable: false,
            },
          ],
        },
      ],
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
    const { run, network, callModel, askEve } = check({
      claimGroundedAnswer,
      network: { [`${APP}/api/auth/sign-in/email`]: { status: 401 } },
    });
    await expect(run).resolves.toEqual({
      status: "ran",
      failed: ["sign_in"],
      groundedAnswer: null,
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(askEve).not.toHaveBeenCalled();
    expect(claimGroundedAnswer).not.toHaveBeenCalled();
    expect(network.urls()).not.toContain(`${APP}/eve/v1/info`);
  });

  it("does not claim or ask Eve after it refused the account, and still signs out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const claimGroundedAnswer = vi.fn(async () => true);
    const { run, network, askEve, callModel } = check({
      claimGroundedAnswer,
      network: { [`${APP}/eve/v1/info`]: { status: 403 } },
    });
    await expect(run).resolves.toEqual({
      status: "ran",
      failed: ["admission", "model"],
      groundedAnswer: null,
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(claimGroundedAnswer).not.toHaveBeenCalled();
    expect(askEve).not.toHaveBeenCalled();
    expect(network.urls().at(-1)).toBe(`${APP}/api/auth/sign-out`);
  });
});

it("fails the model step when Eve does not name its model", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { run, callModel } = check({
    network: { [`${APP}/eve/v1/info`]: { status: 200, body: { agent: {} } } },
  });
  await expect(run).resolves.toMatchObject({ failed: ["model"] });
  expect(callModel).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

/** A gateway error as the SDK throws it: a class name, a status, and the gateway's fields. */
function gatewayError(fields: {
  name: string;
  statusCode: number;
  type: string;
  isRetryable: boolean;
  generationId?: string;
}) {
  return Object.assign(new Error("upstream said something about the prompt"), fields);
}

const UNAVAILABLE = {
  name: "GatewayInternalServerError",
  statusCode: 503,
  type: "internal_server_error",
  isRetryable: true,
  generationId: "gen_01K9Z3",
};

/**
 * One attempt that never answers. The gateway SDK masks the probe's own
 * deadline as a retryable 500, so the attempt rejects with that, not a timeout.
 */
const hangs = async ({ abortSignal }: { abortSignal: AbortSignal }) =>
  new Promise<void>((_, reject) => {
    abortSignal.addEventListener("abort", () =>
      reject(
        gatewayError({
          name: "GatewayResponseError",
          statusCode: 500,
          type: "response_error",
          isRetryable: true,
        }),
      ),
    );
  });

const settlesAfter = (ms: number, outcome: () => void) => () =>
  new Promise<void>((resolve, reject) =>
    setTimeout(() => {
      try {
        outcome();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, ms),
  );

describe("the model step", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Runs the check under fake timers until it settles, with every log captured. */
  async function runModelStep(
    attempts: Array<(input: { abortSignal: AbortSignal }) => Promise<void>>,
  ) {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const callModel = vi.fn(async (input: { abortSignal: AbortSignal }) => {
      const attempt = attempts[callModel.mock.calls.length - 1];
      if (!attempt) throw new Error("called more often than the test allows");
      return attempt(input);
    });
    const { run } = check({ callModel });
    await vi.runAllTimersAsync();
    const result = await run;
    const modelLogs = [...error.mock.calls, ...info.mock.calls].filter(
      ([, fields]) => (fields as { step?: string } | undefined)?.step === "model",
    );
    return { result, callModel, modelLogs };
  }

  it("logs a passing step's latency so it can be read against the budget", async () => {
    const { result, callModel, modelLogs } = await runModelStep([settlesAfter(1_200, () => {})]);
    expect(result).toMatchObject({ failed: [] });
    expect(callModel).toHaveBeenCalledOnce();
    expect(modelLogs).toEqual([
      [
        "first_value_check.passed",
        { step: "model", elapsedMs: 1_200, attempts: [{ outcome: "passed", elapsedMs: 1_200 }] },
      ],
    ]);
  });

  it("names a hung call as the deadline, not the masked gateway error", async () => {
    const { result, callModel, modelLogs } = await runModelStep([hangs]);
    expect(result).toMatchObject({ failed: ["model"] });
    expect(callModel).toHaveBeenCalledOnce();
    expect(modelLogs).toEqual([
      [
        "first_value_check.failed",
        {
          step: "model",
          reason: "deadline",
          elapsedMs: 15_000,
          attempts: [{ outcome: "deadline", elapsedMs: 15_000 }],
        },
      ],
    ]);
  });

  it("keeps an upstream failure when the deadline fires during the retry's wait", async () => {
    const { result, callModel, modelLogs } = await runModelStep([
      settlesAfter(14_000, () => {
        throw gatewayError(UNAVAILABLE);
      }),
    ]);
    expect(result).toMatchObject({ failed: ["model"] });
    expect(callModel).toHaveBeenCalledOnce();
    expect(modelLogs).toEqual([
      [
        "first_value_check.failed",
        {
          step: "model",
          reason: "deadline",
          elapsedMs: 15_000,
          attempts: [
            {
              outcome: "failed",
              elapsedMs: 14_000,
              error: "GatewayInternalServerError",
              status: 503,
              type: "internal_server_error",
              retryable: true,
              generationId: "gen_01K9Z3",
            },
          ],
        },
      ],
    ]);
  });

  it("does not retry an error the gateway marks permanent", async () => {
    const { result, callModel, modelLogs } = await runModelStep([
      async () => {
        throw gatewayError({
          name: "GatewayAuthenticationError",
          statusCode: 401,
          type: "authentication_error",
          isRetryable: false,
        });
      },
    ]);
    expect(result).toMatchObject({ failed: ["model"] });
    expect(callModel).toHaveBeenCalledOnce();
    expect(modelLogs[0]?.[1]).toMatchObject({
      reason: "GatewayAuthenticationError",
      elapsedMs: 0,
      attempts: [{ outcome: "failed", status: 401, retryable: false }],
    });
  });

  it("passes on a retry and still shows the attempt that failed", async () => {
    const { result, callModel, modelLogs } = await runModelStep([
      async () => {
        throw gatewayError(UNAVAILABLE);
      },
      settlesAfter(800, () => {}),
    ]);
    expect(result).toMatchObject({ failed: [] });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(modelLogs).toEqual([
      [
        "first_value_check.passed",
        {
          step: "model",
          elapsedMs: 2_800,
          attempts: [
            expect.objectContaining({ outcome: "failed", status: 503 }),
            { outcome: "passed", elapsedMs: 800 },
          ],
        },
      ],
    ]);
  });

  it("makes at most three calls, backing off two then four seconds", async () => {
    const unavailable = async () => {
      throw gatewayError(UNAVAILABLE);
    };
    const { result, callModel, modelLogs } = await runModelStep([
      unavailable,
      unavailable,
      unavailable,
    ]);
    expect(result).toMatchObject({ failed: ["model"] });
    expect(callModel).toHaveBeenCalledTimes(3);
    expect(modelLogs[0]?.[1]).toMatchObject({
      reason: "GatewayInternalServerError",
      elapsedMs: 6_000,
      attempts: [{ status: 503 }, { status: 503 }, { status: 503 }],
    });
  });

  it("logs only allowlisted fields, dropping anything that is not a short token", async () => {
    const { modelLogs } = await runModelStep([
      async () => {
        throw Object.assign(new Error("Marlow's favourite tea is lapsang souchong"), {
          name: "Error: synthetic-check@example.test",
          statusCode: "503",
          type: "see https://example.test/?cookie=abc",
          isRetryable: false,
          generationId: `gen_${"x".repeat(200)}`,
          responseBody: "the model's reply",
        });
      },
    ]);
    expect(modelLogs[0]?.[1]).toEqual({
      step: "model",
      reason: "unknown",
      elapsedMs: 0,
      attempts: [{ outcome: "failed", elapsedMs: 0, retryable: false }],
    });
  });
});

it("makes one model call per attempt, leaving retries to the step", async () => {
  vi.useFakeTimers();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  gatewayModel.doGenerate = vi.fn(async () => {
    throw new APICallError({
      message: "Service Unavailable",
      url: "https://gateway.example.test",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });
  });
  const run = checkFirstValuePath({
    env: ENV,
    fetch: fakeNetwork().fetch,
    priceIsActive: async () => true,
  });
  await vi.runAllTimersAsync();
  await expect(run).resolves.toMatchObject({ failed: ["model"] });
  // The AI SDK's own default would make three calls per attempt, nine in all.
  expect(gatewayModel.doGenerate).toHaveBeenCalledTimes(3);
  expect(error).toHaveBeenCalledWith(
    "first_value_check.failed",
    expect.objectContaining({ step: "model", reason: "AI_APICallError" }),
  );
  vi.useRealTimers();
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
