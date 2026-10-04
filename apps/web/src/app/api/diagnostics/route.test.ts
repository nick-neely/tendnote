import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks, allowsErrorReports, getSession, rateLimitCheck } = vi.hoisted(() => ({
  rateLimitCheck: vi.fn(async (_request: { subject: string; costCategory: string }) => ({
    allowed: true,
  })),
  afterTasks: [] as (() => Promise<void>)[],
  allowsErrorReports: vi.fn(async (_input: { userId: string }) => true),
  getSession: vi.fn(
    async (_input: { headers: Headers }) =>
      ({ user: { id: "user_SENTINEL" } }) as {
        user: { id: string };
      } | null,
  ),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => afterTasks.push(task) }));
vi.mock("@tendnote/db/queries/account-telemetry", () => ({ allowsErrorReports }));
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/rate-limit", () => ({ getProductRateLimiter: () => ({ check: rateLimitCheck }) }));

import { POST } from "./route";

/** Every synthetic sensitive value carries this marker, so one search finds any leak. */
const LEAK = /sentinel|203\.0\.113\.77/i;

const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

/** A sanitized report with unsanitized extras a tampered or buggy page might add. */
const REPORT = {
  code: "TypeError",
  operation: "window_error",
  frames: [
    {
      file: "https://app.tendnote.test/_next/static/chunks/page.js?person=SENTINEL",
      function: "PersonCard",
      line: 10,
      column: 5,
    },
  ],
  browser: { name: "firefox", major: 143 },
  message: "Could not save Jane Sentinel",
  url: "https://app.tendnote.test/people/person_SENTINEL?email=jane.sentinel@example.com",
  breadcrumbs: [{ category: "ui.click", message: "Delete Jane Sentinel" }],
  user: { id: "user_SENTINEL", ip_address: "203.0.113.77" },
  console: ["SENTINEL console output"],
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.tendnote.test/api/diagnostics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=sess_SENTINEL",
      "user-agent": "SentinelBrowser/1.0",
      referer: "https://app.tendnote.test/people/person_SENTINEL",
      "x-forwarded-for": "203.0.113.77",
      "x-vercel-ip-country": "US",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function runAfterTasks() {
  for (const task of afterTasks.splice(0)) await task();
}

beforeEach(() => {
  vi.stubEnv("TENDNOTE_ADMISSION_MODE", "hosted");
  vi.stubEnv("GLITCHTIP_DSN", "https://publickey@glitchtip.test/42");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  afterTasks.length = 0;
  fetchMock.mockClear();
  allowsErrorReports.mockReset().mockResolvedValue(true);
  getSession.mockReset().mockResolvedValue({ user: { id: "user_SENTINEL" } });
  rateLimitCheck.mockReset().mockResolvedValue({ allowed: true });
});

describe("POST /api/diagnostics", () => {
  it("forwards only the rebuilt envelope, after answering, with none of the request", async () => {
    const response = await POST(post(REPORT));

    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();

    await runAfterTasks();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(`${String(url)} ${JSON.stringify(init?.headers)} ${String(init?.body)}`).not.toMatch(
      LEAK,
    );
    expect(Object.keys(init?.headers ?? {}).sort()).toEqual(["content-type", "x-sentry-auth"]);
    expect(JSON.parse(String(init?.body))).toEqual({
      platform: "javascript",
      level: "error",
      release: "0123456789ab",
      transaction: "browser window_error",
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: {
              frames: [
                {
                  filename: "/_next/static/chunks/page.js",
                  function: "PersonCard",
                  lineno: 10,
                  colno: 5,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      contexts: { browser: { name: "firefox", version: "143" } },
    });
  });

  it("charges the account's report budget", async () => {
    await POST(post(REPORT));

    expect(rateLimitCheck).toHaveBeenCalledExactlyOnceWith({
      subject: "user_SENTINEL",
      costCategory: "diagnostic-report",
    });
  });

  it("checks the account at capture and again before forwarding", async () => {
    allowsErrorReports.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await POST(post(REPORT));
    await runAfterTasks();

    expect(allowsErrorReports).toHaveBeenCalledTimes(2);
    expect(allowsErrorReports).toHaveBeenCalledWith({ userId: "user_SENTINEL" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a signed-out page", () => getSession.mockResolvedValue(null), {}],
    ["an account that opted out", () => allowsErrorReports.mockResolvedValue(false), {}],
    ["an unknown region", () => {}, { "x-vercel-ip-country": "" }],
    ["a non-US region", () => {}, { "x-vercel-ip-country": "GB" }],
    ["an unreadable session", () => getSession.mockRejectedValue(new Error("down")), {}],
    ["a deployment without a DSN", () => vi.stubEnv("GLITCHTIP_DSN", ""), {}],
    [
      "an account over its report budget",
      () => rateLimitCheck.mockResolvedValue({ allowed: false }),
      {},
    ],
  ])("forwards nothing for %s and answers the same", async (_name, arrange, headers) => {
    arrange();

    const response = await POST(post(REPORT, headers));
    await runAfterTasks();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    ["an unknown operation", { ...REPORT, operation: "/people/SENTINEL" }],
    ["an oversized body", { ...REPORT, padding: "x".repeat(20_000) }],
  ])("drops %s without reading the session", async (_name, body) => {
    const response = await POST(post(body));
    await runAfterTasks();

    expect(response.status).toBe(204);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
