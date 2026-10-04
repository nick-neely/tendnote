import { describe, expect, it } from "vitest";
import { parseBrowserDiagnostic } from "./browser-report";
import { MAX_FRAMES } from "./envelope";

/** Every synthetic sensitive value carries this marker, so one search finds any leak. */
const LEAK = /sentinel|203\.0\.113\.77/i;

describe("parseBrowserDiagnostic", () => {
  const valid = {
    code: "TypeError",
    operation: "error_boundary",
    frames: [{ file: "/_next/static/chunks/page.js", function: "PersonCard", line: 10, column: 5 }],
    browser: { name: "chrome", major: 140 },
  };

  it("rebuilds a report from its four fields and drops everything else", () => {
    const parsed = parseBrowserDiagnostic({
      ...valid,
      message: "Jane Sentinel could not be saved",
      breadcrumbs: [{ message: "clicked SENTINEL" }],
      user: { id: "user_SENTINEL", email: "jane.sentinel@example.com" },
      request: {
        url: "https://app.tendnote.test/people/SENTINEL",
        headers: { cookie: "SENTINEL" },
      },
      console: ["SENTINEL console line"],
      ip: "203.0.113.77",
      frames: [
        {
          file: "https://app.tendnote.test/_next/static/chunks/page.js?q=SENTINEL",
          function: "jane.sentinel@example.com",
          line: 10,
          column: 5,
          vars: { email: "jane.sentinel@example.com" },
        },
      ],
      browser: { name: "chrome", major: 140, userAgent: "SentinelAgent/1.0" },
    });

    expect(parsed).toEqual({
      ...valid,
      frames: [{ file: "/_next/static/chunks/page.js", function: "?", line: 10, column: 5 }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(LEAK);
  });

  it.each([
    ["an unknown code", { ...valid, code: "SentinelError" }],
    ["a free-form operation", { ...valid, operation: "/people/SENTINEL" }],
    ["an unknown browser", { ...valid, browser: { name: "Sentinel", major: 1 } }],
    ["a fractional version", { ...valid, browser: { name: "chrome", major: 1.5 } }],
    ["a string line number", { ...valid, frames: [{ ...valid.frames[0], line: "10" }] }],
    [
      "too many frames",
      { ...valid, frames: Array.from({ length: MAX_FRAMES + 1 }, () => valid.frames[0]) },
    ],
    ["no object", "SENTINEL"],
  ])("refuses %s", (_name, raw) => {
    expect(parseBrowserDiagnostic(raw)).toBeNull();
  });
});
