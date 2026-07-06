import { describe, expect, it } from "vitest";
import {
  composeExtractedActionNotes,
  createDeterministicSuggestedActionExtractionAdapter,
  decideActionExtraction,
  extractedActionDedupeKey,
  MAX_EXTRACTED_ACTION_CANDIDATES,
  resolveExtractedActionScope,
  validateSuggestedActionCandidates,
} from "./action-extraction";

describe("decideActionExtraction", () => {
  it("extracts from an active, normal record without requiring linked people", () => {
    expect(
      decideActionExtraction({ sourceRecord: { status: "active", sensitivity: "normal" } }),
    ).toEqual({ action: "extract" });
  });

  it("skips a record that is not active", () => {
    expect(
      decideActionExtraction({ sourceRecord: { status: "archived", sensitivity: "normal" } }),
    ).toEqual({ action: "skip", reason: "source_record_not_active" });
  });

  it("skips restricted content unless directly requested", () => {
    expect(
      decideActionExtraction({ sourceRecord: { status: "active", sensitivity: "restricted" } }),
    ).toEqual({ action: "skip", reason: "restricted_content" });

    expect(
      decideActionExtraction({
        sourceRecord: { status: "active", sensitivity: "restricted" },
        directlyRequested: true,
      }),
    ).toEqual({ action: "extract" });
  });
});

describe("validateSuggestedActionCandidates", () => {
  const base = {
    resolvedPeople: [{ id: "person-1" }],
    availableAreas: [{ id: "area-1", name: "Home" }],
  };

  it("keeps a well-formed candidate and drops unknown people and areas", () => {
    const result = validateSuggestedActionCandidates(
      {
        candidates: [
          {
            title: "Replace the refrigerator water filter",
            personIds: ["person-1", "person-unknown"],
            areaId: "area-unknown",
          },
        ],
      },
      base,
    );

    expect(result.invalidCandidateCount).toBe(0);
    expect(result.validCandidates).toHaveLength(1);
    // Unknown person filtered out, unknown area cleared — the action still stands.
    expect(result.validCandidates[0]?.personIds).toEqual(["person-1"]);
    expect(result.validCandidates[0]?.areaId).toBeUndefined();
  });

  it("keeps a known area id", () => {
    const result = validateSuggestedActionCandidates(
      { candidates: [{ title: "Do a thing", areaId: "area-1" }] },
      base,
    );
    expect(result.validCandidates[0]?.areaId).toBe("area-1");
  });

  it("counts a candidate with no title as invalid without flagging the envelope", () => {
    const result = validateSuggestedActionCandidates(
      { candidates: [{ reason: "no title" }] },
      base,
    );
    expect(result.validCandidates).toHaveLength(0);
    expect(result.invalidCandidateCount).toBe(1);
    expect(result.envelopeInvalid).toBe(false);
  });

  it("flags a malformed envelope distinctly from a bad candidate", () => {
    const result = validateSuggestedActionCandidates({ candidates: "nope" }, base);
    expect(result.validCandidates).toHaveLength(0);
    expect(result.envelopeInvalid).toBe(true);
    // Not miscounted as one bad candidate.
    expect(result.invalidCandidateCount).toBe(0);
  });

  it("caps output at MAX_EXTRACTED_ACTION_CANDIDATES and reports the drop", () => {
    const candidates = Array.from({ length: MAX_EXTRACTED_ACTION_CANDIDATES + 5 }, (_, i) => ({
      title: `Action ${i}`,
    }));
    const result = validateSuggestedActionCandidates({ candidates }, base);
    expect(result.validCandidates).toHaveLength(MAX_EXTRACTED_ACTION_CANDIDATES);
    expect(result.droppedOverCapCount).toBe(5);
  });
});

describe("resolveExtractedActionScope", () => {
  it("defaults to private", () => {
    expect(
      resolveExtractedActionScope({ sourceRecord: { scope: "private", householdId: null } }),
    ).toEqual({ scope: "private", householdId: null });
  });

  it("does not widen from guild/channel capture context alone", () => {
    // A private source record cannot yield a household proposal even if the model asks.
    expect(
      resolveExtractedActionScope({
        sourceRecord: { scope: "private", householdId: "house-1" },
        candidateScope: "household",
      }),
    ).toEqual({ scope: "private", householdId: null });
  });

  it("proposes household only when the owner scoped the record to a concrete household and the candidate asks", () => {
    expect(
      resolveExtractedActionScope({
        sourceRecord: { scope: "household", householdId: "house-1" },
        candidateScope: "household",
      }),
    ).toEqual({ scope: "household", householdId: "house-1" });

    // Household source but candidate did not ask — stay private, fail-closed.
    expect(
      resolveExtractedActionScope({
        sourceRecord: { scope: "household", householdId: "house-1" },
      }),
    ).toEqual({ scope: "private", householdId: null });
  });
});

describe("extractedActionDedupeKey", () => {
  it("normalizes title case and surrounding whitespace", () => {
    expect(extractedActionDedupeKey("  Replace The Filter ")).toBe(
      extractedActionDedupeKey("replace the filter"),
    );
  });
});

describe("composeExtractedActionNotes", () => {
  it("returns null when there is nothing to say", () => {
    expect(composeExtractedActionNotes({})).toBeNull();
  });

  it("combines reason with priority and effort tags", () => {
    expect(
      composeExtractedActionNotes({
        reason: "Filter is overdue",
        priority: "high",
        effort: "small",
      }),
    ).toBe("Filter is overdue\n\nPriority: high · Effort: small");
  });

  it("keeps a bare reason", () => {
    expect(composeExtractedActionNotes({ reason: "Overdue" })).toBe("Overdue");
  });
});

describe("createDeterministicSuggestedActionExtractionAdapter", () => {
  it("infers no actions without a model", async () => {
    const adapter = createDeterministicSuggestedActionExtractionAdapter();
    await expect(
      adapter.extractActions({
        sourceRecord: {
          id: "s1",
          content: "note",
          ownerUserId: "u1",
          sensitivity: "normal",
          scope: "private",
          importance: 3,
        },
        resolvedPeople: [],
        availableAreas: [],
      }),
    ).resolves.toEqual({ candidates: [] });
  });
});
