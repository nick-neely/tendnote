import { describe, expect, it } from "vitest";
import {
  coarseBrowser,
  diagnosticErrorCode,
  MAX_FRAMES,
  sanitizeStack,
  sanitizeStackFile,
  serverEnvelope,
  serverOperation,
} from "./envelope";

/** Every synthetic sensitive value carries this marker, so one search finds any leak. */
const LEAK = /sentinel|203\.0\.113\.77/i;

function errorWithStack(error: Error, frames: string[]): Error {
  error.stack = [`${error.name}: ${error.message}`, ...frames].join("\n");
  return error;
}

describe("diagnosticErrorCode", () => {
  it.each([
    [new Error("x"), "Error"],
    [new TypeError("x"), "TypeError"],
    [new RangeError("x"), "RangeError"],
    [Object.assign(new Error("x"), { name: "ChunkLoadError" }), "ChunkLoadError"],
    [Object.assign(new Error("x"), { name: "SentinelCustomerError" }), "UnknownError"],
    ["a thrown string with jane.sentinel@example.com", "NonError"],
    [null, "NonError"],
  ])("maps %o to %s and never to anything the error says", (error, code) => {
    expect(diagnosticErrorCode(error)).toBe(code);
  });
});

describe("sanitizeStackFile", () => {
  it.each([
    [
      "https://app.tendnote.test/_next/static/chunks/app/page-3f2a.js?dpl=SENTINEL#frag",
      "/_next/static/chunks/app/page-3f2a.js",
    ],
    [
      "/home/sentinel-user/tendnote/apps/web/.next/server/chunks/ssr/[root]/page.js",
      ".next/server/chunks/ssr/[root]/page.js",
    ],
    [
      "file:///var/task/node_modules/next/dist/server/base-server.js",
      "node_modules/next/dist/server/base-server.js",
    ],
    [
      "/home/sentinel-user/tendnote/node_modules/.pnpm/next@16.3.3_@babel+core@7.28.4/node_modules/next/dist/server/lib/router-server.js",
      "node_modules/next/dist/server/lib/router-server.js",
    ],
    ["node:internal/process/task_queues", "node:internal/process/task_queues"],
    ["https://app.tendnote.test/people/person_SENTINEL", "<unknown>"],
    ["chrome-extension://sentinelextension/content.js", "<unknown>"],
    ["https://app.tendnote.test/_next/static/jane.sentinel@example.com.js", "<unknown>"],
    ["/home/sentinel-user/notes.ts", "<unknown>"],
  ])("keeps only the shipped path of %s", (raw, expected) => {
    expect(sanitizeStackFile(raw)).toBe(expected);
  });
});

describe("sanitizeStack", () => {
  it("reads V8 frames and never the message, even a message shaped like a frame", () => {
    const error = errorWithStack(
      new TypeError(
        "Cannot read Jane Sentinel's notes\n    at forged (https://app.tendnote.test/_next/jane.sentinel@example.com:1:1)",
      ),
      [
        "    at PersonCard (https://app.tendnote.test/_next/static/chunks/page.js?person=SENTINEL:10:5)",
        "    at async Object.<anonymous> (/var/task/apps/web/.next/server/app/page.js:3:14)",
        "    at new Foo (https://app.tendnote.test/_next/static/chunks/foo.js:7:1)",
        "    at https://app.tendnote.test/people/SENTINEL?email=jane.sentinel@example.com:1:1",
        "    at Object.[jane.sentinel@example.com] (https://app.tendnote.test/_next/static/chunks/x.js:2:3)",
        "    at async Promise.all (index 0)",
      ],
    );

    const frames = sanitizeStack(error);

    expect(frames).toEqual([
      { file: "/_next/static/chunks/page.js", function: "PersonCard", line: 10, column: 5 },
      { file: ".next/server/app/page.js", function: "Object.<anonymous>", line: 3, column: 14 },
      { file: "/_next/static/chunks/foo.js", function: "Foo", line: 7, column: 1 },
      { file: "<unknown>", function: "?", line: 1, column: 1 },
      { file: "/_next/static/chunks/x.js", function: "?", line: 2, column: 3 },
    ]);
    expect(JSON.stringify(frames)).not.toMatch(LEAK);
  });

  it.each([
    [
      "a message changed",
      (error: Error) => {
        error.message = "later";
      },
    ],
    [
      "a name changed",
      (error: Error) => {
        error.name = "TypeError";
      },
    ],
  ])("trusts no frame once %s after the stack was written", (_name, mutate) => {
    const error = new Error(
      "x\njane.sentinel@example.com:1:2\n    at JaneSentinel.acct_SENTINEL (/x/.next/server/a.js:1:2)",
    );
    void error.stack;
    mutate(error);

    expect(sanitizeStack(error)).toEqual([]);
  });

  it("never reads a Gecko-shaped message line in a V8 stack as a frame", () => {
    const error = errorWithStack(new Error("x\nJaneSentinel@example.com:1:2"), [
      "    at load (/x/.next/server/a.js:3:4)",
    ]);

    expect(sanitizeStack(error)).toEqual([
      { file: ".next/server/a.js", function: "load", line: 3, column: 4 },
    ]);
  });

  it("trusts no Gecko frame when the stack holds the message", () => {
    const error = new Error("JaneSentinel@example.com:1:2");
    error.stack =
      "JaneSentinel@example.com:1:2\nsave@https://app.tendnote.test/_next/static/chunks/save.js:4:9";

    expect(sanitizeStack(error)).toEqual([]);
  });

  it("reads Gecko and WebKit frames", () => {
    const error = new Error("Jane Sentinel");
    error.stack = [
      "save@https://app.tendnote.test/_next/static/chunks/save.js:4:9",
      "@https://app.tendnote.test/_next/static/chunks/main.js:1:2",
    ].join("\n");

    expect(sanitizeStack(error)).toEqual([
      { file: "/_next/static/chunks/save.js", function: "save", line: 4, column: 9 },
      { file: "/_next/static/chunks/main.js", function: "?", line: 1, column: 2 },
    ]);
  });

  it("keeps at most the innermost frames", () => {
    const frames = Array.from(
      { length: MAX_FRAMES + 10 },
      (_, i) => `    at f${i} (/x/.next/a.js:${i}:1)`,
    );
    expect(sanitizeStack(errorWithStack(new Error("x"), frames))).toHaveLength(MAX_FRAMES);
  });

  it("has no frames for a value that is not an error", () => {
    expect(sanitizeStack("at x (/x/.next/a.js:1:1)")).toEqual([]);
  });
});

describe("coarseBrowser", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36",
      { name: "chrome", major: 140 },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54",
      { name: "edge", major: 140 },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
      { name: "firefox", major: 143 },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      { name: "safari", major: 18 },
    ],
    ["SentinelBot/1.0 (+https://sentinel.example)", { name: "other", major: null }],
  ])("reduces %s to a family and major version", (userAgent, expected) => {
    expect(coarseBrowser(userAgent)).toEqual(expected);
  });
});

describe("serverOperation", () => {
  it("names the route's pattern, never the request path", () => {
    expect(
      serverOperation({ routeType: "render", routePath: "/(member)/people/[personId]/page" }),
    ).toBe("render /(member)/people/[personId]/page");
  });

  it.each([
    [{ routeType: "render", routePath: "/people/SENTINEL?email=jane.sentinel@example.com" }],
    [{ routeType: "jane.sentinel@example.com", routePath: 42 }],
  ])("drops what is not a route pattern", (context) => {
    expect(serverOperation(context)).not.toMatch(LEAK);
  });
});

describe("serverEnvelope", () => {
  it("carries the code, stack, route, and Node major version, and not the message", () => {
    const error = errorWithStack(new RangeError("jane.sentinel@example.com over limit"), [
      "    at load (/var/task/apps/web/.next/server/chunks/load.js:5:6)",
    ]);

    expect(
      serverEnvelope(error, { routeType: "action", routePath: "/(member)/page" }, "24.18.0"),
    ).toEqual({
      platform: "node",
      code: "RangeError",
      operation: "action /(member)/page",
      frames: [{ file: ".next/server/chunks/load.js", function: "load", line: 5, column: 6 }],
      runtime: { name: "node", major: 24 },
    });
  });
});
