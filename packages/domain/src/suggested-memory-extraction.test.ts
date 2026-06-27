import { describe, expect, it } from "vitest";
import {
  createDeterministicSuggestedMemoryExtractionAdapter,
  createFakeSuggestedMemoryExtractionAdapter,
  stricterSensitivity,
  validateSuggestedMemoryCandidates,
} from "./suggested-memory-extraction";

describe("suggested-memory extraction candidate validation", () => {
  const resolvedPeople = [
    { id: "person-1", displayName: "Mara" },
    { id: "person-2", displayName: "Noah" },
  ];

  it("accepts bounded candidate metadata for resolved people", () => {
    const result = validateSuggestedMemoryCandidates(
      {
        candidates: [
          {
            personId: "person-1",
            content: "Mara prefers early dinners.",
            memoryType: "preference",
            importance: 4,
            confidence: "high",
            sensitivity: "normal",
          },
        ],
      },
      { resolvedPeople },
    );

    expect(result.invalidCandidateCount).toBe(0);
    expect(result.validCandidates).toEqual([
      {
        personId: "person-1",
        content: "Mara prefers early dinners.",
        memoryType: "preference",
        importance: 4,
        confidence: "high",
        sensitivity: "normal",
      },
    ]);
  });

  it("rejects invalid metadata and people outside the resolved set", () => {
    const result = validateSuggestedMemoryCandidates(
      {
        candidates: [
          { personId: "person-1", content: "", memoryType: "context" },
          { personId: "person-1", content: "Mara likes tea.", memoryType: "invalid" },
          { personId: "person-1", content: "Mara likes tea.", importance: 10 },
          { personId: "person-1", content: "Mara likes tea.", confidence: "certain" },
          { personId: "person-1", content: "Mara likes tea.", sensitivity: "secret" },
          { personId: "person-3", content: "Jordan likes tea." },
          { personId: "person-2", content: "Noah is learning piano.", memoryType: "context" },
        ],
      },
      { resolvedPeople },
    );

    expect(result.invalidCandidateCount).toBe(6);
    expect(result.validCandidates).toEqual([
      {
        personId: "person-2",
        content: "Noah is learning piano.",
        memoryType: "context",
      },
    ]);
  });

  it("rejects malformed adapter result objects", () => {
    expect(
      validateSuggestedMemoryCandidates({ candidates: "not-an-array" }, { resolvedPeople }),
    ).toEqual({
      validCandidates: [],
      invalidCandidateCount: 1,
    });
  });
});

describe("suggested-memory extraction sensitivity policy", () => {
  it("does not let candidate classification lower source-record sensitivity", () => {
    expect(stricterSensitivity("sensitive", "normal")).toBe("sensitive");
    expect(stricterSensitivity("restricted", "sensitive")).toBe("restricted");
  });

  it("uses stricter candidate sensitivity when it is more restrictive", () => {
    expect(stricterSensitivity("normal", "sensitive")).toBe("sensitive");
    expect(stricterSensitivity("sensitive", "restricted")).toBe("restricted");
  });
});

describe("suggested-memory extraction adapters", () => {
  it("keeps deterministic extraction available as a test/local adapter", async () => {
    const adapter = createDeterministicSuggestedMemoryExtractionAdapter();

    const result = await adapter.extractCandidates({
      sourceRecord: {
        id: "source-1",
        ownerUserId: "user-1",
        content: "Mara is moving in July.",
        sensitivity: "sensitive",
        confidence: "medium",
        importance: 3,
      },
      resolvedPeople: [{ id: "person-1", displayName: "Mara" }],
    });

    expect(adapter.kind).toBe("deterministic");
    expect(result.candidates).toEqual([
      {
        personId: "person-1",
        content: "Mara is moving in July.",
        memoryType: "context",
        importance: 3,
        confidence: "medium",
        sensitivity: "sensitive",
      },
    ]);
  });

  it("supports fake adapters for normal verification", async () => {
    const adapter = createFakeSuggestedMemoryExtractionAdapter([
      { personId: "person-1", content: "Mara likes green tea.", memoryType: "preference" },
    ]);

    await expect(
      adapter.extractCandidates({
        sourceRecord: {
          id: "source-1",
          ownerUserId: "user-1",
          content: "raw note",
          sensitivity: "normal",
          confidence: "medium",
          importance: 3,
        },
        resolvedPeople: [{ id: "person-1", displayName: "Mara" }],
      }),
    ).resolves.toEqual({
      candidates: [
        { personId: "person-1", content: "Mara likes green tea.", memoryType: "preference" },
      ],
    });
  });
});
