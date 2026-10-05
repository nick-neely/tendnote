// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every synthetic sensitive value carries this marker, so one search finds any leak. */
const LEAK = /sentinel/i;

const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

/** A fresh module per test: the per-page cap and the already-reported set are module state. */
async function reporter() {
  vi.resetModules();
  return (await import("./browser")).reportBrowserError;
}

function sensitiveError(message = "Could not save Jane Sentinel <jane.sentinel@example.com>") {
  const error = new TypeError(message);
  error.stack = [
    `TypeError: ${message}`,
    "    at PersonCard (https://app.tendnote.test/_next/static/chunks/page.js?person=SENTINEL:10:5)",
    "    at https://app.tendnote.test/people/person_SENTINEL:1:1",
  ].join("\n");
  return error;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 SentinelToolbar/2.0",
  );
  window.history.replaceState(null, "", "/people/person_SENTINEL?email=jane.sentinel@example.com");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockClear();
});

describe("reportBrowserError", () => {
  it("sanitizes in the page: no message, URL, or user-agent string leaves it", async () => {
    const reportBrowserError = await reporter();

    reportBrowserError(sensitiveError(), "error_boundary");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/diagnostics");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", keepalive: true });
    expect(String(init?.body)).not.toMatch(LEAK);
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "TypeError",
      operation: "error_boundary",
      frames: [
        { file: "/_next/static/chunks/page.js", function: "PersonCard", line: 10, column: 5 },
        { file: "<unknown>", function: "?", line: 1, column: 1 },
      ],
      browser: { name: "chrome", major: 140 },
    });
  });

  it("reports one error once, however many places catch it", async () => {
    const reportBrowserError = await reporter();
    const error = sensitiveError();

    reportBrowserError(error, "error_boundary");
    reportBrowserError(error, "window_error");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caps the reports a page can send", async () => {
    const reportBrowserError = await reporter();

    for (let i = 0; i < 8; i += 1)
      reportBrowserError(sensitiveError(`failure ${i}`), "window_error");

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each([
    [
      "a Server Components placeholder, already reported by the server",
      Object.assign(new Error("x"), { digest: "123" }),
    ],
    ["a thrown string", "jane.sentinel@example.com"],
    ["a cross-origin script error", null],
  ])("sends nothing for %s", async (_name, error) => {
    const reportBrowserError = await reporter();

    reportBrowserError(error, "window_error");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even when the request cannot be made", async () => {
    const reportBrowserError = await reporter();
    fetchMock.mockImplementationOnce(() => {
      throw new TypeError("Failed to fetch");
    });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(() => reportBrowserError(sensitiveError("a"), "window_error")).not.toThrow();
    expect(() => reportBrowserError(sensitiveError("b"), "window_error")).not.toThrow();
  });
});
