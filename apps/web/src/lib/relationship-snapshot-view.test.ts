import type { PersonContextSnapshotResult } from "@tendnote/db/queries/context-snapshots";
import type { ContextSnapshot } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { toRelationshipSnapshotView } from "./relationship-snapshot-view";

const EMPTY_CONTEXT = {
  person: null,
  approvedMemories: [],
  sourceRecords: [],
  suggestedMemories: [],
};

function snapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  const now = new Date("2026-06-20T00:00:00Z");
  return {
    id: "snapshot-1",
    ownerUserId: "user-1",
    personId: "person-1",
    summary: "Mark is a friend relationship.\nConfirmed: Mark is vegetarian.",
    supportingReferences: {
      personIds: ["person-1"],
      memoryIds: ["memory-1"],
      sourceRecordIds: ["source-1", "source-2"],
      suggestedMemoryIds: ["suggested-1"],
      followupIds: ["followup-1"],
    },
    followups: [
      { id: "followup-1", status: "open", dueAt: "2026-07-01T00:00:00.000Z", reason: "Check in." },
    ],
    generatorVersion: "deterministic-v1",
    inputFingerprint: "fp",
    generatedAt: now,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function result(overrides: Partial<PersonContextSnapshotResult> = {}): PersonContextSnapshotResult {
  return {
    status: "fresh",
    snapshot: snapshot(),
    context: EMPTY_CONTEXT,
    ...overrides,
  };
}

describe("toRelationshipSnapshotView", () => {
  it("exposes the generated summary read-only with no edit affordance", () => {
    const view = toRelationshipSnapshotView(result());

    expect(view.summary).toContain("Mark is vegetarian.");
    expect(view.fallback).toBe(false);
    // The view carries only display data — there is no field to edit the summary.
    expect(Object.keys(view)).not.toContain("editableSummary");
  });

  it("routes corrections to the underlying person and records, not the snapshot text", () => {
    const view = toRelationshipSnapshotView(result());

    expect(view.corrections).toEqual([
      { kind: "person", text: "your profile", count: 1, href: "#person-header" },
      { kind: "memory", text: "1 memory", count: 1, href: "#memories" },
      { kind: "source_record", text: "2 notes", count: 2, href: "#logged-context" },
      { kind: "followup", text: "1 follow-up", count: 1, href: "#follow-ups" },
    ]);
  });

  it("only routes to records the snapshot actually references", () => {
    const view = toRelationshipSnapshotView(
      result({
        snapshot: snapshot({
          supportingReferences: {
            personIds: ["person-1"],
            memoryIds: [],
            sourceRecordIds: [],
            suggestedMemoryIds: [],
            followupIds: [],
          },
          followups: [],
        }),
      }),
    );

    // No fabricated affordances: a restricted-free snapshot with no record refs
    // routes only to the person profile, never to records it does not cite.
    expect(view.corrections.map((c) => c.kind)).toEqual(["person"]);
  });

  it("separates suggested memories from the durable summary", () => {
    const view = toRelationshipSnapshotView(result());

    expect(view.suggestedMemoryCount).toBe(1);
    // The suggested memory is not represented as a durable correction target.
    expect(view.corrections.map((c) => c.kind)).not.toContain("suggested_memory");
  });

  it("surfaces compact follow-up context", () => {
    const view = toRelationshipSnapshotView(result());

    expect(view.followups).toEqual([
      { id: "followup-1", status: "open", dueAt: expect.any(String), reason: "Check in." },
    ]);
  });

  it("falls back without a summary when the snapshot is unavailable", () => {
    const view = toRelationshipSnapshotView(result({ status: "fallback", snapshot: null }));

    expect(view.fallback).toBe(true);
    expect(view.summary).toBeNull();
    expect(view.corrections).toEqual([]);
    expect(view.followups).toEqual([]);
  });

  it("withholds a stale generated summary on a failed rebuild", () => {
    const stale = snapshot({ failureReason: "model down" });
    const view = toRelationshipSnapshotView(result({ status: "fallback", snapshot: stale }));

    expect(view.fallback).toBe(true);
    expect(view.summary).toBeNull();
  });
});
