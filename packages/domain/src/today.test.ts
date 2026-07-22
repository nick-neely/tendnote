import { describe, expect, it } from "vitest";
import { curateTodayCandidates, type TodayCandidate, type TodayFeedback } from "./today";

const NOW = new Date("2026-07-21T15:00:00.000Z");

function mandatoryCandidate(
  id: string,
  dueAt: string,
  family: TodayCandidate["family"] = "action",
): TodayCandidate {
  return {
    identity: `${family}:${id}:due`,
    family,
    record: {
      kind: family === "follow_up" ? "follow_up" : "general_action",
      id,
      href: family === "follow_up" ? `/people/person-1#followup-${id}` : `/actions#action-${id}`,
    },
    title: `Record ${id}`,
    context: "Authoritative domain context",
    reason: {
      code: "overdue",
      key: `due:${dueAt}`,
      explanation: "Overdue from its stored date.",
    },
    sourceRefs: [{ kind: "general_action", id }],
    action: {
      kind: family === "follow_up" ? "complete_follow_up" : "complete_action",
      label: "Complete",
    },
    mandatory: true,
    dueAt: new Date(dueAt),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    sensitivity: "normal",
  };
}

function optionalCandidate(
  id: string,
  family: TodayCandidate["family"],
  createdAt: string,
): TodayCandidate {
  const recordKind =
    family === "saved_item" ? "saved_item" : family === "review" ? "review_item" : "memory";
  return {
    identity: `${family}:${id}`,
    family,
    record: { kind: recordKind, id, href: family === "saved_item" ? "/saved-items" : "/" },
    title: `Optional ${id}`,
    context: "Grounded optional context",
    reason: {
      code: family === "review" ? "awaiting_review" : "aged_after_cooldown",
      key: `reason:${id}`,
      explanation: "Eligible after deterministic policy checks.",
    },
    sourceRefs: [{ kind: recordKind, id }],
    action: {
      kind: family === "review" ? "open_review" : "open_record",
      label: family === "review" ? "Review" : "Open",
    },
    mandatory: false,
    dueAt: null,
    createdAt: new Date(createdAt),
    sensitivity: "normal",
  };
}

describe("Today deterministic curation", () => {
  it("caps mandatory overflow by oldest overdue then chronological due time", () => {
    const candidates = [
      mandatoryCandidate("same-day-late", "2026-07-21T18:00:00.000Z"),
      mandatoryCandidate("oldest", "2026-07-18T09:00:00.000Z", "follow_up"),
      mandatoryCandidate("same-day-early", "2026-07-21T10:00:00.000Z"),
      mandatoryCandidate("middle", "2026-07-20T09:00:00.000Z"),
      mandatoryCandidate("future", "2026-07-22T09:00:00.000Z"),
      mandatoryCandidate("older", "2026-07-19T09:00:00.000Z"),
    ];

    const result = curateTodayCandidates({ candidates, now: NOW });

    expect(result.items.map((item) => item.record.id)).toEqual([
      "oldest",
      "older",
      "middle",
      "same-day-early",
      "same-day-late",
    ]);
    expect(result.items).toHaveLength(5);
    expect(result.overflow).toEqual({
      mandatoryCount: 6,
      omittedCount: 1,
      destinations: [{ family: "action", label: "Actions", href: "/actions" }],
    });
    expect(result.optionalCandidates).toEqual([]);
  });

  it("suppresses only the matching candidate reason and lets a material reason change return", () => {
    const candidate = mandatoryCandidate("filter", "2026-07-20T09:00:00.000Z");
    const feedback: TodayFeedback = {
      ownerUserId: "owner-1",
      candidateIdentity: candidate.identity,
      reasonKey: candidate.reason.key,
      kind: "not_today",
      localDate: "2026-07-21",
      suppressUntil: null,
    };

    const suppressed = curateTodayCandidates({
      candidates: [candidate],
      feedback: [feedback],
      localDate: "2026-07-21",
      now: NOW,
    });
    const changedReason = curateTodayCandidates({
      candidates: [
        {
          ...candidate,
          reason: {
            ...candidate.reason,
            key: "due:2026-07-22T09:00:00.000Z",
            explanation: "Due today after its stored date changed.",
          },
        },
      ],
      feedback: [feedback],
      localDate: "2026-07-21",
      now: NOW,
    });

    expect(suppressed.items).toEqual([]);
    expect(changedReason.items).toHaveLength(1);
  });

  it("keeps mandatory items fixed and accepts only a validated optional order up to the normal target", () => {
    const mandatory = mandatoryCandidate("due", "2026-07-20T09:00:00.000Z");
    const saved = optionalCandidate("saved", "saved_item", "2026-06-01T00:00:00.000Z");
    const review = optionalCandidate("review", "review", "2026-07-01T00:00:00.000Z");
    const context = optionalCandidate(
      "context",
      "relationship_context",
      "2026-05-01T00:00:00.000Z",
    );

    const result = curateTodayCandidates({
      candidates: [review, mandatory, context, saved],
      now: NOW,
      optionalOrder: ["saved_item:saved", "action:invented", "review:review"],
    });

    expect(result.items.map((item) => item.identity)).toEqual([
      mandatory.identity,
      saved.identity,
      review.identity,
    ]);
    expect(result.optionalCandidates.map((item) => item.identity)).toEqual([
      context.identity,
      saved.identity,
      review.identity,
    ]);
  });

  it("excludes restricted proactive content, deduplicates identity, and bounds each optional family", () => {
    const actionCandidates = Array.from({ length: 7 }, (_, index) =>
      optionalCandidate(
        `action-${index}`,
        "action",
        `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const duplicate = {
      ...actionCandidates[0],
      title: "Duplicate representation",
    } as TodayCandidate;
    const restricted = {
      ...optionalCandidate("private", "saved_item", "2026-05-01T00:00:00.000Z"),
      sensitivity: "restricted" as const,
    };

    const result = curateTodayCandidates({
      candidates: [...actionCandidates, duplicate, restricted],
      now: NOW,
    });

    expect(result.optionalCandidates).toHaveLength(4);
    expect(new Set(result.optionalCandidates.map((candidate) => candidate.identity)).size).toBe(4);
    expect(result.optionalCandidates.every((candidate) => candidate.family === "action")).toBe(
      true,
    );
  });

  it("balances deterministic optional fallback across families", () => {
    const candidates = [
      optionalCandidate("action-oldest", "action", "2026-04-01T00:00:00.000Z"),
      optionalCandidate("action-older", "action", "2026-04-02T00:00:00.000Z"),
      optionalCandidate("action-old", "action", "2026-04-03T00:00:00.000Z"),
      optionalCandidate("saved", "saved_item", "2026-05-01T00:00:00.000Z"),
      optionalCandidate("review", "review", "2026-06-01T00:00:00.000Z"),
    ];

    const result = curateTodayCandidates({ candidates, now: NOW });

    expect(result.items.map((item) => item.family)).toEqual(["action", "saved_item", "review"]);
  });
});
