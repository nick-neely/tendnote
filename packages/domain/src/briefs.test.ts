import { describe, expect, it } from "vitest";
import {
  briefItemIdentityKeys,
  isBriefItemFeedbackActive,
  resolveBriefItemTransition,
} from "./briefs";

describe("brief item transitions", () => {
  it("moves active items to dismissed, snoozed, and acted-on", () => {
    expect(resolveBriefItemTransition("active", "dismiss")).toBe("dismissed");
    expect(resolveBriefItemTransition("active", "snooze")).toBe("snoozed");
    expect(resolveBriefItemTransition("active", "act")).toBe("acted_on");
  });

  it("lets a snoozed item be dismissed or acted-on", () => {
    expect(resolveBriefItemTransition("snoozed", "dismiss")).toBe("dismissed");
    expect(resolveBriefItemTransition("snoozed", "act")).toBe("acted_on");
  });

  it("rejects invalid transitions out of terminal states", () => {
    expect(() => resolveBriefItemTransition("dismissed", "snooze")).toThrow(/dismissed/);
    expect(() => resolveBriefItemTransition("acted_on", "dismiss")).toThrow(/acted_on/);
  });
});

describe("brief item feedback suppression", () => {
  const now = new Date("2026-06-27T12:00:00Z");

  it("treats dismissed and acted-on as durable feedback", () => {
    expect(isBriefItemFeedbackActive({ status: "dismissed", snoozedUntil: null }, now)).toBe(true);
    expect(isBriefItemFeedbackActive({ status: "acted_on", snoozedUntil: null }, now)).toBe(true);
  });

  it("treats a snooze as active only until it expires", () => {
    expect(
      isBriefItemFeedbackActive(
        { status: "snoozed", snoozedUntil: new Date("2026-06-28T12:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isBriefItemFeedbackActive(
        { status: "snoozed", snoozedUntil: new Date("2026-06-26T12:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("does not suppress active items", () => {
    expect(isBriefItemFeedbackActive({ status: "active", snoozedUntil: null }, now)).toBe(false);
  });
});

describe("brief item identity keys", () => {
  it("binds kind, person, and each source ref together", () => {
    expect(
      briefItemIdentityKeys({
        kind: "due_followup",
        personId: "person-1",
        sourceRefs: [
          { kind: "followup", id: "f1" },
          { kind: "source_record", id: "s1" },
        ],
      }),
    ).toEqual([
      "due_followup|person:person-1|source:followup:f1",
      "due_followup|person:person-1|source:source_record:s1",
    ]);
  });

  it("encodes a missing person as an empty segment", () => {
    expect(
      briefItemIdentityKeys({
        kind: "review_item",
        personId: null,
        sourceRefs: [{ kind: "source_record", id: "s1" }],
      }),
    ).toEqual(["review_item|person:|source:source_record:s1"]);
  });

  it("does not match the same person across different source references", () => {
    const followupA = briefItemIdentityKeys({
      kind: "due_followup",
      personId: "p1",
      sourceRefs: [{ kind: "followup", id: "fa" }],
    });
    const followupB = briefItemIdentityKeys({
      kind: "due_followup",
      personId: "p1",
      sourceRefs: [{ kind: "followup", id: "fb" }],
    });

    expect(followupA.some((key) => followupB.includes(key))).toBe(false);
  });

  it("does not match the same source/person across different kinds", () => {
    const followup = briefItemIdentityKeys({
      kind: "due_followup",
      personId: "p1",
      sourceRefs: [{ kind: "person", id: "p1" }],
    });
    const birthday = briefItemIdentityKeys({
      kind: "birthday",
      personId: "p1",
      sourceRefs: [{ kind: "person", id: "p1" }],
    });

    expect(followup.some((key) => birthday.includes(key))).toBe(false);
  });
});
