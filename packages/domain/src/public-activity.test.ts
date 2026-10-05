import { describe, expect, it } from "vitest";
import {
  PUBLIC_ACTIVITY_EVENTS,
  parsePublicActivity,
  publicActivityCutoffDay,
  publicActivityDay,
} from "./public-activity";

describe("the public activity event set", () => {
  it("is the telemetry decision's four public events", () => {
    expect(PUBLIC_ACTIVITY_EVENTS).toEqual([
      "page_viewed",
      "demo_started",
      "demo_completed",
      "signup_clicked",
    ]);
  });
});

describe("reading a public activity report", () => {
  it("accepts a fixed event on a fixed page", () => {
    expect(parsePublicActivity('{"event":"page_viewed","page":"pricing"}')).toEqual({
      event: "page_viewed",
      page: "pricing",
    });
  });

  it("keeps only the event and page", () => {
    expect(parsePublicActivity('{"event":"signup_clicked","page":"home","visitor":"abc"}')).toEqual(
      { event: "signup_clicked", page: "home" },
    );
  });

  it.each([
    ["an unknown event", '{"event":"clicked","page":"home"}'],
    ["an unknown page", '{"event":"page_viewed","page":"/pricing?ref=x"}'],
    ["a missing page", '{"event":"page_viewed"}'],
    ["a non-string event", '{"event":1,"page":"home"}'],
    ["an array", '["page_viewed","home"]'],
    ["null", "null"],
    ["malformed JSON", "{"],
    ["an empty body", ""],
  ])("rejects %s", (_name, body) => {
    expect(parsePublicActivity(body)).toBeNull();
  });
});

describe("the daily counter's day", () => {
  it("is the UTC calendar day", () => {
    expect(publicActivityDay(new Date("2026-10-03T23:30:00-05:00"))).toBe("2026-10-04");
  });
});

describe("the thirteen-month retention cutoff", () => {
  it("is the same day thirteen months back", () => {
    expect(publicActivityCutoffDay(new Date("2026-10-03T12:00:00Z"))).toBe("2025-09-03");
  });

  it("clamps to the end of a shorter month", () => {
    expect(publicActivityCutoffDay(new Date("2027-03-31T12:00:00Z"))).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(publicActivityCutoffDay(new Date("2027-01-15T00:00:00Z"))).toBe("2025-12-15");
  });
});
