import { describe, expect, it } from "vitest";
import { routeExplicitConversationalCapture } from "./conversational-capture";

describe("explicit conversational Capture routing", () => {
  const now = new Date("2026-07-21T04:30:00.000Z");

  it("routes an explicit supported self-orienting statement into private Self Context", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember that I run a small software consultancy",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "context_fact",
      category: "work",
      content: "I run a small software consultancy",
      sensitivity: "normal",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Save this about me: I live in Chicago",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "context_fact",
      category: "location",
      content: "I live in Chicago",
      sensitivity: "normal",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "I prefer concise answers",
        allowSelfContext: true,
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "context_fact",
      category: "preference",
      content: "I prefer concise answers",
      sensitivity: "normal",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "I prefer concise answers",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "I need to replace the filter tomorrow",
        allowSelfContext: true,
        timeZone: "America/Chicago",
      }),
    ).toMatchObject({ destination: "action" });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember that I live at 123 Main Street",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });

    for (const originalText of [
      "Remember that my plan is to replace the filter",
      "Remember that my calendar has a meeting Friday",
      "Remember that my timezone is America/Chicago",
      "Remember that my car needs an oil change",
      "Remember that my work calendar has a meeting Friday",
      "Remember that my preferred timezone is America/Chicago",
      "Remember that my kitchen refrigerator filter needs replacing",
      "Remember that my follow-up with Priya is Friday",
      "Remember that I should replace the filter",
    ]) {
      expect(
        routeExplicitConversationalCapture({ now, originalText, timeZone: "America/Chicago" }),
      ).toEqual({ destination: "saved_item" });
    }
  });

  it("routes explicit Person, Memory, and Asset-review requests without promoting inferred facts", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Add Priya",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "person", displayName: "Priya" });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember that Priya prefers oat milk",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "memory",
      content: "Priya prefers oat milk",
      personQuery: "Priya",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Track asset refrigerator water filter: model EDR4RXD1",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "asset_review",
      assetKind: "item",
      assetName: "refrigerator water filter",
      fact: "model EDR4RXD1",
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Priya prefers oat milk",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });
  });

  it("groups only independently explicit clauses and leaves implicit fan-out as one fallback", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText:
          "Add Priya; and also remember that Priya prefers oat milk; and also track asset refrigerator water filter: model EDR4RXD1",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "group",
      outcomes: [
        { destination: "person", displayName: "Priya" },
        {
          destination: "memory",
          content: "Priya prefers oat milk",
          personQuery: "Priya",
        },
        {
          destination: "asset_review",
          assetKind: "item",
          assetName: "refrigerator water filter",
          fact: "model EDR4RXD1",
        },
      ],
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Remember that Priya prefers oat milk; maybe add a reminder too",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });
  });

  it("groups an explicitly requested Action and open question without turning fallback text into fan-out", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText:
          "Remind me to replace the kitchen refrigerator filter on August 21 with an alert one week before; and also save an open question: Where should I buy the replacement filter? Bring it back on August 14",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "group",
      outcomes: [
        {
          destination: "action",
          dueAt: new Date("2026-08-21T14:00:00.000Z"),
          recurrence: null,
          reminderSchedule: { kind: "relative", leadMinutes: 10_080 },
          title: "Replace the kitchen refrigerator filter",
        },
        {
          destination: "saved_item",
          explicit: true,
          kind: "open_question",
          text: "Where should I buy the replacement filter?",
          bringBackAt: new Date("2026-08-14T14:00:00.000Z"),
        },
      ],
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "I need to replace the filter; maybe remember where to buy it",
        timeZone: "America/Chicago",
      }),
    ).toEqual({ destination: "saved_item" });
  });

  it("treats a Saved Item date as bring-back timing only when the owner says to bring it back", () => {
    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Save a note: August 14 is the refrigerator warranty date",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "saved_item",
      explicit: true,
      kind: "note",
      text: "August 14 is the refrigerator warranty date",
      bringBackAt: null,
    });

    expect(
      routeExplicitConversationalCapture({
        now,
        originalText: "Save an open question: Where should I buy it? Bring it back soon",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      destination: "clarification",
      field: "timing",
      question: "When should I bring this Saved Item back?",
    });
  });

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
