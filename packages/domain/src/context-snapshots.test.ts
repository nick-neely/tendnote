import { describe, expect, it } from "vitest";
import {
  buildSnapshotPrompt,
  collectSnapshotReferences,
  computeSnapshotFingerprint,
  DETERMINISTIC_GENERATOR_VERSION,
  generateDeterministicSnapshot,
  type SnapshotInputPack,
} from "./context-snapshots";
import type { Memory } from "./memories";
import type { Person } from "./people";
import type { SourceRecord } from "./source-records";

const OWNER = "user-1";

function person(overrides: Partial<Person> = {}): Person {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id: "person-1",
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date("2026-01-02T00:00:00Z");
  return {
    id: "memory-1",
    personId: "person-1",
    ownerUserId: OWNER,
    sourceRecordId: "source-1",
    memoryType: "context",
    content: "Mark is vegetarian.",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "medium",
    scope: "private",
    approvedAt: now,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sourceRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
  const now = new Date("2026-01-03T00:00:00Z");
  return {
    id: "source-1",
    ownerUserId: OWNER,
    sourceType: "manual",
    content: "Had lunch with Mark; he seemed energized.",
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("collectSnapshotReferences", () => {
  it("derives record-level references straight from the input pack", () => {
    const input: SnapshotInputPack = {
      person: person(),
      approvedMemories: [memory()],
      sourceRecords: [sourceRecord()],
      suggestedMemories: [
        memory({ id: "memory-2", status: "suggested", content: "Maybe moving." }),
      ],
      followups: [{ id: "followup-1" }],
    };

    expect(collectSnapshotReferences(input)).toEqual({
      personIds: ["person-1"],
      memoryIds: ["memory-1"],
      sourceRecordIds: ["source-1"],
      suggestedMemoryIds: ["memory-2"],
      followupIds: ["followup-1"],
    });
  });
});

describe("generateDeterministicSnapshot", () => {
  it("produces prose grounded in the person and approved memories", () => {
    const input: SnapshotInputPack = {
      person: person(),
      approvedMemories: [memory()],
      sourceRecords: [sourceRecord()],
      suggestedMemories: [],
      followups: [],
    };

    const result = generateDeterministicSnapshot(input);

    expect(result.summary).toContain("Mark");
    expect(result.summary).toContain("vegetarian");
  });

  it("does not state suggested memories as confirmed facts in prose", () => {
    const input: SnapshotInputPack = {
      person: person(),
      approvedMemories: [],
      sourceRecords: [],
      suggestedMemories: [
        memory({ id: "memory-2", status: "suggested", content: "Maybe moving soon." }),
      ],
      followups: [],
    };

    const result = generateDeterministicSnapshot(input);

    expect(result.summary).not.toContain("Maybe moving soon.");
  });

  it("uses logged-context phrasing for source records", () => {
    const input: SnapshotInputPack = {
      person: person(),
      approvedMemories: [],
      sourceRecords: [sourceRecord()],
      suggestedMemories: [],
      followups: [],
    };

    const result = generateDeterministicSnapshot(input);

    expect(result.summary.toLowerCase()).toMatch(/you (noted|logged|mentioned)/);
  });
});

describe("buildSnapshotPrompt", () => {
  it("frames confirmed facts and logged context, and excludes suggested-memory content", () => {
    const prompt = buildSnapshotPrompt({
      person: person({ profileBlurb: "Met at a conference." }),
      approvedMemories: [memory({ content: "Mark is vegetarian." })],
      sourceRecords: [sourceRecord({ content: "Had lunch last week." })],
      suggestedMemories: [
        memory({ id: "memory-2", status: "suggested", content: "Maybe switching jobs." }),
      ],
      followups: [],
    });

    // Confirmed facts and logged context are framed distinctly.
    expect(prompt).toContain("Confirmed facts");
    expect(prompt).toContain("Mark is vegetarian.");
    expect(prompt).toMatch(/you noted/i);
    expect(prompt).toContain("Had lunch last week.");
    expect(prompt).toContain("Met at a conference.");
    // Suggested-memory content is hard-excluded from the prompt (ADR 0009), so a
    // tentative observation can never be promoted to a fact in the cached card.
    expect(prompt).not.toContain("Maybe switching jobs.");
  });
});

describe("computeSnapshotFingerprint", () => {
  const base: SnapshotInputPack = {
    person: person(),
    approvedMemories: [memory()],
    sourceRecords: [sourceRecord()],
    suggestedMemories: [memory({ id: "memory-2", status: "suggested" })],
    followups: [{ id: "followup-1" }],
  };

  it("is stable for identical inputs", () => {
    expect(computeSnapshotFingerprint(base)).toBe(
      computeSnapshotFingerprint({ ...base, approvedMemories: [memory()] }),
    );
  });

  it("changes when a person profile field changes", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({ ...base, person: person({ profileBlurb: "Now a neighbor." }) }),
    );
  });

  it("changes when a memory is updated", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({
        ...base,
        approvedMemories: [memory({ updatedAt: new Date("2026-02-01T00:00:00Z") })],
      }),
    );
  });

  it("changes when a linked source record changes", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({
        ...base,
        sourceRecords: [sourceRecord({ updatedAt: new Date("2026-02-01T00:00:00Z") })],
      }),
    );
  });

  it("changes when a review-visible suggested memory changes", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({ ...base, suggestedMemories: [] }),
    );
  });

  it("changes when a relevant follow-up changes", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({ ...base, followups: [] }),
    );
  });
});

describe("DETERMINISTIC_GENERATOR_VERSION", () => {
  it("is a non-empty identifier", () => {
    expect(DETERMINISTIC_GENERATOR_VERSION.length).toBeGreaterThan(0);
  });
});
