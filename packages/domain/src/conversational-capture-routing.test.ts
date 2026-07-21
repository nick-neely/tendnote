import { describe, expect, it } from "vitest";
import { routeExplicitConversationalCapture } from "./conversational-capture";

describe("explicit conversational Capture routing", () => {
  const now = new Date("2026-07-21T04:30:00.000Z");

  it("keeps one-time work unscheduled when no reminder timing was requested", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "I need to replace the refrigerator water filter",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "action",
      dueAt: null,
      recurrence: null,
      title: "Replace the refrigerator water filter",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to replace the refrigerator water filter",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "clarification",
      field: "timing",
      question: "When should I remind you to replace the refrigerator water filter?",
    });
  });

  it("routes only a clear supported cadence to a Routine", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember to replace the filter every 6 months",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "action",
      dueAt: null,
      recurrence: { interval: 6, unit: "month" },
      title: "Replace the filter",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember to replace the filter regularly",
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({ destination: "clarification", field: "cadence" });

    for (const originalText of [
      "Remember to replace the filter every 0 days",
      "Remember to replace the filter every 366 days",
    ]) {
      expect(
        routeExplicitConversationalCapture({ now, originalText, timeZone: "America/Chicago" }),
      ).toMatchObject({ destination: "clarification", field: "cadence" });
    }
  });

  it("resolves tomorrow at the deterministic local reminder time in the owner's timezone", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to order filters tomorrow",
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({
      destination: "action",
      dueAt: new Date("2026-07-21T14:00:00.000Z"),
      title: "Order filters",
    });
  });

  it("resolves a named weekday against the owner's local date", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to order filters Friday",
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({
      destination: "action",
      dueAt: new Date("2026-07-24T14:00:00.000Z"),
      title: "Order filters",
    });
  });

  it("asks one focused question for vague or impossible timing", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to order filters sometime",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "clarification",
      field: "timing",
      question: "When should I remind you to order filters?",
    });
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to order filters on February 30",
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({ destination: "clarification", field: "timing" });
  });

  it("identifies a person-scoped reminder without resolving the person in policy code", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remind me to follow up with Maya tomorrow",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "followup",
      dueAt: new Date("2026-07-21T14:00:00.000Z"),
      personQuery: "Maya",
      reason: "Follow up",
    });
  });

  it("leaves ordinary notes and questions in the private Saved Item fallback", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "The refrigerator uses filter model RPWFE",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });
  });
});
