import { describe, expect, it } from "vitest";
import {
  buildSnapshotPrompt,
  collectCompactFollowups,
  collectSnapshotReferences,
  computeSnapshotFingerprint,
  DETERMINISTIC_GENERATOR_VERSION,
  generateDeterministicSnapshot,
  type SnapshotInputPack,
  selectSnapshotFollowups,
} from "./context-snapshots";
import type { Followup } from "./followups";
import type { Memory } from "./memories";
import type { Person } from "./people";
import type { SourceRecord } from "./source-records";

function followup(overrides: Partial<Followup> = {}): Followup {
  const now = new Date("2026-01-04T00:00:00Z");
  return {
    id: "followup-1",
    personId: "person-1",
    ownerUserId: OWNER,
    reason: "Check in about the new job.",
    dueAt: new Date("2026-02-01T00:00:00Z"),
    status: "open",
    cadence: null,
    lastPromptedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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
      followups: [followup()],
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

  it("instructs plain prose with no Markdown and no restated name/role header", () => {
    const prompt = buildSnapshotPrompt({
      person: person(),
      approvedMemories: [],
      sourceRecords: [],
      suggestedMemories: [],
      followups: [],
    });

    // The card renders the summary as plain text and already shows the name and
    // relationship, so the prompt asks the model not to emit Markdown or a header.
    expect(prompt).toMatch(/no markdown/i);
    expect(prompt).toMatch(/plain prose/i);
    expect(prompt).toMatch(/do not start with or repeat the person's name/i);
  });
});

describe("computeSnapshotFingerprint", () => {
  const base: SnapshotInputPack = {
    person: person(),
    approvedMemories: [memory()],
    sourceRecords: [sourceRecord()],
    suggestedMemories: [memory({ id: "memory-2", status: "suggested" })],
    followups: [followup()],
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

  it("changes when a follow-up status, due date, or reason changes", () => {
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({ ...base, followups: [followup({ status: "completed" })] }),
    );
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({
        ...base,
        followups: [followup({ dueAt: new Date("2026-03-01T00:00:00Z") })],
      }),
    );
    expect(computeSnapshotFingerprint(base)).not.toBe(
      computeSnapshotFingerprint({
        ...base,
        followups: [followup({ reason: "Different reason." })],
      }),
    );
  });
});

describe("selectSnapshotFollowups", () => {
  const now = new Date("2026-06-25T00:00:00Z");

  it("includes active (open/snoozed) follow-ups and excludes suggested/dismissed/archived", () => {
    const result = selectSnapshotFollowups(
      [
        followup({ id: "open-1", status: "open" }),
        followup({ id: "snoozed-1", status: "snoozed" }),
        followup({ id: "suggested-1", status: "suggested" }),
        followup({ id: "dismissed-1", status: "dismissed" }),
        followup({ id: "archived-1", status: "archived" }),
      ],
      now,
    );

    expect(result.map((f) => f.id).sort()).toEqual(["open-1", "snoozed-1"]);
  });

  it("includes recently completed follow-ups but not stale ones", () => {
    const recent = followup({
      id: "recent",
      status: "completed",
      updatedAt: new Date("2026-06-10T00:00:00Z"),
    });
    const stale = followup({
      id: "stale",
      status: "completed",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = selectSnapshotFollowups([recent, stale], now);

    expect(result.map((f) => f.id)).toEqual(["recent"]);
  });

  it("orders selected follow-ups by due date", () => {
    const later = followup({ id: "later", dueAt: new Date("2026-07-01T00:00:00Z") });
    const sooner = followup({ id: "sooner", dueAt: new Date("2026-06-26T00:00:00Z") });

    expect(selectSnapshotFollowups([later, sooner], now).map((f) => f.id)).toEqual([
      "sooner",
      "later",
    ]);
  });
});

describe("collectCompactFollowups", () => {
  it("maps follow-ups to compact references with id, status, due date, and reason", () => {
    const input: SnapshotInputPack = {
      person: person(),
      approvedMemories: [],
      sourceRecords: [],
      suggestedMemories: [],
      followups: [
        followup({
          id: "followup-9",
          status: "open",
          dueAt: new Date("2026-02-01T00:00:00Z"),
          reason: "Send birthday note.",
        }),
      ],
    };

    expect(collectCompactFollowups(input)).toEqual([
      {
        id: "followup-9",
        status: "open",
        dueAt: "2026-02-01T00:00:00.000Z",
        reason: "Send birthday note.",
      },
    ]);
  });
});

describe("DETERMINISTIC_GENERATOR_VERSION", () => {
  it("is a non-empty identifier", () => {
    expect(DETERMINISTIC_GENERATOR_VERSION.length).toBeGreaterThan(0);
  });
});
