import { describe, expect, it } from "vitest";
import { eveUsageNoticeText, pausedNoticeFromError, recoveryText } from "./usage-notice";

const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

describe("recoveryText", () => {
  it("states the reset day for the Usage Period", () => {
    expect(recoveryText({ kind: "resets_on", date: "2026-11-15" })).toBe("Resets on November 15.");
  });

  it("reads the reset day as a calendar day, whatever the viewer's time zone", () => {
    expect(recoveryText({ kind: "resets_on", date: "2026-12-01" })).toBe("Resets on December 1.");
  });

  it("gives no date while service is being restored", () => {
    expect(recoveryText({ kind: "service_restored" })).toBe("Resumes when service is restored.");
  });

  it("says retrying for a queued retry", () => {
    expect(recoveryText({ kind: "retrying" })).toBe("Retrying.");
  });
});

describe("eveUsageNoticeText", () => {
  it("says Eve is on a lighter model over the Fair-Use Budget, until the reset", () => {
    expect(
      eveUsageNoticeText({ state: "reduced", recovery: { kind: "resets_on", date: "2026-11-15" } }),
    ).toEqual({
      headline: "Eve is using a lighter model.",
      detail:
        "You've used this month's full-quality turns, so Eve continues on a lighter model up to the monthly limit. Resets on November 15.",
    });
  });

  it("says Eve has reached the monthly limit at the Account Ceiling", () => {
    expect(eveUsageNoticeText(paused)).toEqual({
      headline: "Eve has reached this month's usage limit.",
      detail: "Everything else in Tendnote still works. Resets on November 15.",
    });
  });

  it("names no month for a restriction that is not the Usage Period's", () => {
    const restored = { kind: "service_restored" } as const;
    expect(eveUsageNoticeText({ state: "paused", recovery: restored })).toEqual({
      headline: "Eve is paused.",
      detail: "Everything else in Tendnote still works. Resumes when service is restored.",
    });
    expect(eveUsageNoticeText({ state: "reduced", recovery: restored })).toEqual({
      headline: "Eve is using a lighter model.",
      detail: "Resumes when service is restored.",
    });
  });
});

describe("pausedNoticeFromError", () => {
  const body = JSON.stringify({ ok: false, code: "eve_usage_paused", notice: paused });

  it("reads the notice Eve refused a turn with", () => {
    expect(pausedNoticeFromError({ code: "eve_usage_paused", status: 403, body })).toEqual(paused);
  });

  it("is null for any other failure", () => {
    expect(pausedNoticeFromError({ code: "session_not_active", status: 409, body: "" })).toBeNull();
    expect(pausedNoticeFromError(new Error("network"))).toBeNull();
    expect(pausedNoticeFromError(null)).toBeNull();
  });

  it("is null when the refusal carries no notice it can read", () => {
    expect(pausedNoticeFromError({ code: "eve_usage_paused", body: "not json" })).toBeNull();
    expect(
      pausedNoticeFromError({
        code: "eve_usage_paused",
        body: JSON.stringify({ notice: { state: "paused", recovery: { kind: "someday" } } }),
      }),
    ).toBeNull();
  });
});
