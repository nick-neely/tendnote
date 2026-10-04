import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ getProductRateLimiter: () => ({}) }));

import { glitchTipTarget } from "./glitchtip";
import { type DiagnosticDependencies, reportServerError } from "./report";

/** Every synthetic sensitive value carries this marker, so one search finds any leak. */
const LEAK = /sentinel|203\.0\.113\.77/i;

const HOSTED = {
  TENDNOTE_ADMISSION_MODE: "hosted",
  GLITCHTIP_DSN: "https://publickey@glitchtip.test/42",
  VERCEL_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
};

/** A request that carries a synthetic sensitive value in every place one could hide. */
const SENSITIVE_REQUEST = {
  path: "/people/person_SENTINEL?email=jane.sentinel@example.com",
  method: "POST",
  headers: {
    cookie: "better-auth.session_token=sess_SENTINEL",
    authorization: "Bearer SENTINEL",
    "x-forwarded-for": "203.0.113.77",
    "x-real-ip": "203.0.113.77",
    "user-agent": "SentinelBrowser/1.0",
    referer: "https://app.tendnote.test/people/person_SENTINEL",
    "x-vercel-ip-country": "US",
    "x-vercel-ip-city": "Sentinelville",
  },
};

const CONTEXT = {
  routerKind: "App Router",
  routePath: "/(member)/people/[personId]/page",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
  renderType: "dynamic",
};

function sensitiveError() {
  const error = new TypeError("Could not load Jane Sentinel <jane.sentinel@example.com>");
  error.stack = [
    `${error.name}: ${error.message}`,
    "    at loadPerson (/var/task/apps/web/.next/server/chunks/ssr/person.js:12:7)",
    "    at async Page (/home/sentinel-user/apps/web/.next/server/app/page.js:40:3)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
  ].join("\n");
  return Object.assign(error, { digest: "1234567890", cause: { sql: "select SENTINEL" } });
}

function harness(overrides: Partial<DiagnosticDependencies> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
  const sessionUserId = vi.fn(async (_headers: Headers): Promise<string | null> => "user_SENTINEL");
  const allowsErrorReports = vi.fn(async (_input: { userId: string }) => true);
  const dependencies: DiagnosticDependencies = {
    env: HOSTED,
    fetch,
    sessionUserId,
    allowsErrorReports,
    waitUntil: (task) => {
      handedOff.push(task);
    },
    ...overrides,
  };
  return { fetch, sessionUserId, allowsErrorReports, dependencies };
}

function sent(fetch: ReturnType<typeof harness>["fetch"]) {
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0] ?? [];
  return {
    url: String(url),
    headers: init?.headers as Record<string, string>,
    body: JSON.parse(String(init?.body)),
    raw: `${String(url)} ${JSON.stringify(init?.headers)} ${String(init?.body)}`,
  };
}

/** Every key path in a JSON value, so the outbound shape is asserted exactly. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** Work the reporter handed to the platform's `waitUntil`. */
const handedOff: Promise<void>[] = [];

/** Report, then wait for the handed-off work as the platform would. */
async function report(
  error: unknown,
  request: typeof SENSITIVE_REQUEST | { headers: Record<string, string> },
  dependencies: DiagnosticDependencies,
) {
  reportServerError(error, request, CONTEXT, dependencies);
  await Promise.all(handedOff.splice(0));
}

afterEach(() => {
  handedOff.length = 0;
});

describe("reportServerError", () => {
  it("sends only the allowed envelope, however much sensitive data the error and request carry", async () => {
    const { fetch, dependencies } = harness();

    await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

    const outbound = sent(fetch);
    expect(outbound.raw).not.toMatch(LEAK);
    expect(outbound.url).toBe("https://glitchtip.test/api/42/store/");
    expect(outbound.headers).toEqual({
      "content-type": "application/json",
      "x-sentry-auth":
        "Sentry sentry_version=7, sentry_client=tendnote-diagnostics/1, sentry_key=publickey",
    });
    expect(outbound.body).toEqual({
      platform: "node",
      level: "error",
      release: "abcdef123456",
      transaction: "render /(member)/people/[personId]/page",
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: {
              frames: [
                {
                  filename: "node:internal/process/task_queues",
                  function: "process.processTicksAndRejections",
                  lineno: 105,
                  colno: 5,
                  in_app: false,
                },
                {
                  filename: ".next/server/app/page.js",
                  function: "Page",
                  lineno: 40,
                  colno: 3,
                  in_app: true,
                },
                {
                  filename: ".next/server/chunks/ssr/person.js",
                  function: "loadPerson",
                  lineno: 12,
                  colno: 7,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      contexts: { runtime: { name: "node", version: expect.stringMatching(/^\d+$/) } },
    });
  });

  it("adds no field beyond the envelope's: no SDK sits between Tendnote and GlitchTip", async () => {
    const { fetch, dependencies } = harness();

    await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

    expect([...new Set(keyPaths(sent(fetch).body))].sort()).toEqual([
      "contexts.runtime.name",
      "contexts.runtime.version",
      "exception.values[].stacktrace.frames[].colno",
      "exception.values[].stacktrace.frames[].filename",
      "exception.values[].stacktrace.frames[].function",
      "exception.values[].stacktrace.frames[].in_app",
      "exception.values[].stacktrace.frames[].lineno",
      "exception.values[].type",
      "level",
      "platform",
      "release",
      "transaction",
    ]);
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(installed.filter((name) => /sentry|glitchtip/i.test(name))).toEqual([]);
  });

  it("decides eligibility from the session cookie and the edge country alone", async () => {
    const { sessionUserId, allowsErrorReports, dependencies } = harness();

    await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

    const headers = sessionUserId.mock.calls[0]?.[0];
    expect(Object.fromEntries(headers?.entries() ?? [])).toEqual({
      cookie: "better-auth.session_token=sess_SENTINEL",
      "x-vercel-ip-country": "US",
    });
    expect(allowsErrorReports).toHaveBeenCalledWith({ userId: "user_SENTINEL" });
  });

  it("reports an anonymous request's error: there is no opt-out to honour", async () => {
    const { fetch, allowsErrorReports, dependencies } = harness({
      sessionUserId: async () => null,
    });

    await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

    expect(fetch).toHaveBeenCalledOnce();
    expect(allowsErrorReports).not.toHaveBeenCalled();
  });

  it("reports a thrown value that is not an error by its code alone", async () => {
    const { fetch, dependencies } = harness();

    await report("jane.sentinel@example.com", SENSITIVE_REQUEST, dependencies);

    const outbound = sent(fetch);
    expect(outbound.raw).not.toMatch(LEAK);
    expect(outbound.body.exception).toEqual({ values: [{ type: "NonError" }] });
  });

  describe("suppression", () => {
    it.each([
      ["an unknown region", undefined],
      ["an empty region", ""],
      ["another country", "CA"],
      ["a Region Block country", "DE"],
    ])("sends nothing for %s, before reading the session", async (_name, country) => {
      const { fetch, sessionUserId, dependencies } = harness();
      const headers: Record<string, string> = { ...SENSITIVE_REQUEST.headers };
      if (country === undefined) delete headers["x-vercel-ip-country"];
      else headers["x-vercel-ip-country"] = country;

      await report(sensitiveError(), { headers }, dependencies);

      expect(fetch).not.toHaveBeenCalled();
      expect(sessionUserId).not.toHaveBeenCalled();
    });

    it("sends nothing for an account that switched telemetry off or asked to be deleted", async () => {
      const { fetch, dependencies } = harness({ allowsErrorReports: async () => false });

      await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

      expect(fetch).not.toHaveBeenCalled();
    });

    it("re-checks the account before forwarding, so an opt-out after capture still stops it", async () => {
      const allowsErrorReports = vi
        .fn(async (_input: { userId: string }) => true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const { fetch, dependencies } = harness({ allowsErrorReports });

      await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

      expect(allowsErrorReports).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [
        "the session cannot be read",
        { sessionUserId: async () => Promise.reject(new Error("db down")) },
      ],
      [
        "the setting cannot be read",
        { allowsErrorReports: async () => Promise.reject(new Error("db down")) },
      ],
    ])("sends nothing when %s", async (_name, overrides) => {
      const { fetch, dependencies } = harness(overrides);

      await expect(
        report(sensitiveError(), SENSITIVE_REQUEST, dependencies),
      ).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [
        "self-hosted",
        {
          ...HOSTED,
          TENDNOTE_ADMISSION_MODE: "self-hosted",
          TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        },
      ],
      ["without a DSN, before the payload-proof gate", { ...HOSTED, GLITCHTIP_DSN: undefined }],
      ["with a malformed DSN", { ...HOSTED, GLITCHTIP_DSN: "not a dsn" }],
    ])("sends nothing %s", async (_name, env) => {
      const { fetch, sessionUserId, dependencies } = harness({ env });

      await report(sensitiveError(), SENSITIVE_REQUEST, dependencies);

      expect(fetch).not.toHaveBeenCalled();
      expect(sessionUserId).not.toHaveBeenCalled();
    });
  });

  describe("never holds up the request", () => {
    it("returns at once and hands the report to the platform", () => {
      const { fetch, sessionUserId, dependencies } = harness({
        fetch: () => new Promise<Response>(() => {}),
      });

      expect(
        reportServerError(sensitiveError(), SENSITIVE_REQUEST, CONTEXT, dependencies),
      ).toBeUndefined();
      expect(handedOff).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(sessionUserId).toHaveBeenCalledOnce();
    });

    it("builds the envelope before handing off, so a later change to the error cannot reach it", async () => {
      const { fetch, dependencies } = harness();
      const error = sensitiveError();

      reportServerError(error, SENSITIVE_REQUEST, CONTEXT, dependencies);
      error.name = "SentinelError";
      error.stack = "    at JaneSentinel (/x/.next/server/jane.sentinel.js:1:1)";
      await Promise.all(handedOff.splice(0));

      const outbound = sent(fetch);
      expect(outbound.raw).not.toMatch(LEAK);
      expect(outbound.body.exception.values[0].type).toBe("TypeError");
    });

    it("swallows a refused or failed send", async () => {
      for (const fetch of [
        vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 429 })),
        vi.fn<typeof globalThis.fetch>(async () => Promise.reject(new TypeError("fetch failed"))),
      ]) {
        const { dependencies } = harness({ fetch });
        await expect(
          report(sensitiveError(), SENSITIVE_REQUEST, dependencies),
        ).resolves.toBeUndefined();
      }
    });
  });
});

describe("glitchTipTarget", () => {
  it.each([
    [
      "https://key@glitchtip.test/7",
      { storeUrl: "https://glitchtip.test/api/7/store/", publicKey: "key" },
    ],
    [
      "http://key@localhost:8000/7",
      { storeUrl: "http://localhost:8000/api/7/store/", publicKey: "key" },
    ],
    ["http://key@glitchtip.test/7", null],
    ["https://glitchtip.test/7", null],
    ["https://key@glitchtip.test/project", null],
    [undefined, null],
  ])("reads %s", (dsn, expected) => {
    expect(glitchTipTarget(dsn)).toEqual(expected);
  });
});
