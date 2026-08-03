import { describe, expect, it } from "vitest";
import {
  CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES,
  createDeterministicContextFactExtractionAdapter,
  createFakeContextFactExtractionAdapter,
  MAX_CONTEXT_FACT_EVIDENCE_LENGTH,
  validateContextFactExtractionCandidates,
} from "./context-fact-extraction";

describe("ambient Context Fact extraction candidate validation", () => {
  const message =
    "I work as a product designer in Chicago and prefer quiet coffee shops. My SSN is 123-45-6789.";

  it("keeps stable, directly supported candidates and minimizes evidence", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "work",
            content: "Works as a product designer.",
            evidence: "I work as a product designer",
          },
          {
            category: "location",
            content: "Is in Chicago.",
            evidence: "in Chicago",
          },
        ],
      },
      { message },
    );

    expect(result.invalidCandidateCount).toBe(0);
    expect(result.validCandidates).toEqual([
      {
        category: "work",
        content: "Works as a product designer.",
        evidence: "I work as a product designer",
        sensitivity: "normal",
      },
      {
        category: "location",
        content: "Is in Chicago.",
        evidence: "in Chicago",
        sensitivity: "normal",
      },
    ]);
  });

  it("rejects inference, transient states, unsupported evidence, and composition facts", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "other",
            content: "Is an introvert.",
            evidence: "I work as a product designer",
          },
          {
            category: "constraint",
            content: "Is stressed today.",
            evidence: "prefer quiet coffee shops",
          },
          {
            category: "preference",
            content: "Likes luxury travel.",
            evidence: "luxury travel",
          },
          {
            category: "composition",
            content: "Has a household.",
            evidence: "I work as a product designer",
          },
        ],
      },
      { message },
    );

    expect(result.invalidCandidateCount).toBe(4);
    expect(result.validCandidates).toEqual([]);
  });

  it("rejects directly stated finance, lifestyle, capability, and values claims", () => {
    const message =
      "I am wealthy, I run every morning, I am skilled at piano, and I value honesty.";
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          { category: "other", content: "Is wealthy.", evidence: "I am wealthy" },
          { category: "other", content: "Runs every morning.", evidence: "I run every morning" },
          {
            category: "other",
            content: "Is skilled at piano.",
            evidence: "I am skilled at piano",
          },
          { category: "other", content: "Values honesty.", evidence: "I value honesty" },
        ],
      },
      { message },
    );

    expect(result).toEqual({ validCandidates: [], invalidCandidateCount: 4 });
  });

  it("rejects a candidate that adds an unsupported claim to grounded wording", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "work",
            content: "Works as a product designer and owns a company.",
            evidence: "I work as a product designer",
          },
        ],
      },
      { message },
    );

    expect(result).toEqual({ validCandidates: [], invalidCandidateCount: 1 });
  });

  it("raises sensitivity when the evidence contains restricted data", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "other",
            content: "Shared an SSN.",
            evidence: "My SSN is 123-45-6789.",
            sensitivity: "normal",
          },
        ],
      },
      { message },
    );

    expect(result.validCandidates).toEqual([
      {
        category: "other",
        content: "Shared an SSN.",
        evidence: "My SSN is 123-45-6789.",
        sensitivity: "restricted",
      },
    ]);
  });

  it("rejects restricted text hidden in candidate content and precise addresses", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "other",
            content: "My password is hunter2.",
            evidence: "I prefer quiet coffee shops",
            sensitivity: "normal",
          },
          {
            category: "location",
            content: "I live at 1600 Pennsylvania Avenue, Washington, DC 20500.",
            evidence: "I live at 1600 Pennsylvania Avenue, Washington, DC 20500.",
          },
        ],
      },
      {
        message:
          "I prefer quiet coffee shops. My password is hunter2. I live at 1600 Pennsylvania Avenue, Washington, DC 20500.",
      },
    );

    expect(result).toEqual({ validCandidates: [], invalidCandidateCount: 2 });
  });

  it("rejects candidates that negate or make the statement historical", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "location",
            content: "I work in Chicago.",
            evidence: "work in Chicago",
          },
          {
            category: "work",
            content: "I work as a designer.",
            evidence: "work as a designer",
          },
        ],
      },
      {
        message: "I do not work in Chicago anymore. I used to work as a designer.",
      },
    );

    expect(result).toEqual({ validCandidates: [], invalidCandidateCount: 2 });
  });

  it("caps candidates per inbound message", () => {
    const result = validateContextFactExtractionCandidates(
      {
        candidates: Array.from({ length: CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES + 1 }, () => ({
          category: "work",
          content: "Works as a product designer.",
          evidence: "I work as a product designer",
        })),
      },
      { message },
    );

    expect(result.validCandidates).toHaveLength(CONTEXT_FACT_EXTRACTION_MAX_CANDIDATES);
    expect(result.invalidCandidateCount).toBe(1);
  });

  it("rejects evidence over the storage bound instead of persisting the message", () => {
    const longEvidence = "I work as a product designer ".padEnd(
      MAX_CONTEXT_FACT_EVIDENCE_LENGTH + 1,
      "x",
    );

    const result = validateContextFactExtractionCandidates(
      {
        candidates: [
          {
            category: "work",
            content: "Works as a product designer.",
            evidence: longEvidence,
          },
        ],
      },
      { message: longEvidence },
    );

    expect(result).toEqual({ validCandidates: [], invalidCandidateCount: 1 });
  });

  it("rejects malformed adapter results", () => {
    expect(
      validateContextFactExtractionCandidates({ candidates: "not-an-array" }, { message }),
    ).toEqual({ validCandidates: [], invalidCandidateCount: 1 });
  });
});

describe("ambient Context Fact extraction adapters", () => {
  it("keeps normal CI deterministic without inventing candidates", async () => {
    const adapter = createDeterministicContextFactExtractionAdapter();

    await expect(adapter.extractCandidates({ message: "I work in Chicago." })).resolves.toEqual({
      candidates: [],
    });
    expect(adapter.kind).toBe("deterministic");
  });

  it("supports explicit fake candidates for processor tests", async () => {
    const adapter = createFakeContextFactExtractionAdapter([
      {
        category: "work",
        content: "Works in design.",
        evidence: "I work in design",
      },
    ]);

    await expect(adapter.extractCandidates({ message: "I work in design." })).resolves.toEqual({
      candidates: [
        {
          category: "work",
          content: "Works in design.",
          evidence: "I work in design",
        },
      ],
    });
  });
});
