import { describe, expect, it } from "vitest";
import {
  backgroundUsageNoticeText,
  eveUsageNoticeText,
  pausedNoticeFromError,
} from "./usage-notice";

const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

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

describe("backgroundUsageNoticeText", () => {
  it("says captures wait and scheduled briefs skip until the reset, and that the rest works", () => {
    expect(backgroundUsageNoticeText(paused)).toEqual({
      headline: "Background work is paused for this month.",
      detail:
        "New captures wait to be processed, and scheduled briefs and reviews skip their next delivery. Everything else in Tendnote still works. Resets on November 15.",
    });
  });

  it("states only the recovery condition it carries", () => {
    expect(
      backgroundUsageNoticeText({ state: "paused", recovery: { kind: "service_restored" } }),
    ).toEqual({
      headline: "Background work is paused.",
      detail:
        "New captures wait to be processed, and scheduled briefs and reviews skip their next delivery. Everything else in Tendnote still works. Resumes when service is restored.",
    });
  });
});
