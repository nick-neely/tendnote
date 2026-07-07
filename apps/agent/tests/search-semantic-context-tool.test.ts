import { describe, expect, it, vi } from "vitest";

const { searchSemanticContext } = vi.hoisted(() => ({
  searchSemanticContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/semantic-retrieval", () => ({
  searchSemanticContext,
}));

const { default: tool } = await import("../agent/tools/search_semantic_context");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

describe("search_semantic_context tool", () => {
  it("calls the shared owner-scoped semantic retrieval query", async () => {
    searchSemanticContext.mockResolvedValue([
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Mara loves cooking classes and handmade kitchen gifts.",
        similarity: 0.91,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        sourceRefs: [{ kind: "memory", id: "memory-1" }],
        routing: { personId: "person-1", recordKind: "memory", recordId: "memory-1" },
      },
    ]);

    const result = await tool.execute(
      { query: "gift ideas", limit: 5, minimumSimilarity: 0, directlyRequested: false },
      ctx,
    );

    expect(searchSemanticContext).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
      // Review context is pinned off by the tool, never model-forwarded.
      includeReviewGated: false,
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        recordKind: "memory",
        recordId: "memory-1",
        snippet: "Mara loves cooking classes and handmade kitchen gifts.",
        trustLevel: "confirmed_fact",
      }),
    );
    expect(result.component).toEqual({ type: "semantic_context_search", resultCount: 1 });
    expect(result).not.toHaveProperty("person");
    expect(result).not.toHaveProperty("snapshot");
  });

  it("returns compact typed references without generated answers or snapshot prose", async () => {
    searchSemanticContext.mockResolvedValue([
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "You logged that Mara might be changing jobs.",
        similarity: 0.87,
        trustLevel: "logged_context",
        sensitivity: "sensitive",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        sourceRefs: [{ kind: "source_record", id: "source-1" }],
        routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
        generatedAnswer: "Do not expose generated answers.",
        snapshot: { summary: "Generated snapshot prose must not become semantic recall truth." },
      },
    ]);

    const result = await tool.execute(
      {
        query: "career updates",
        recordKinds: ["source_record"],
        limit: 5,
        minimumSimilarity: 0,
        directlyRequested: false,
      },
      ctx,
    );

    expect(result.results).toEqual([
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "You logged that Mara might be changing jobs.",
        similarity: 0.87,
        trustLevel: "logged_context",
        sensitivity: "sensitive",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        sourceRefs: [{ kind: "source_record", id: "source-1" }],
        routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("generatedAnswer");
    expect(JSON.stringify(result)).not.toContain("Generated snapshot prose");
  });

  it("keeps semantic recall distinct from exact recall and context loading", async () => {
    searchSemanticContext.mockResolvedValue([]);

    await tool.execute(
      {
        query: "stressful life events",
        recordKinds: ["memory", "source_record"],
        limit: 8,
        minimumSimilarity: 0.2,
        directlyRequested: true,
      },
      ctx,
    );

    expect(searchSemanticContext).toHaveBeenLastCalledWith({
      ownerUserId: "user-1",
      query: "stressful life events",
      recordKinds: ["memory", "source_record"],
      limit: 8,
      minimumSimilarity: 0.2,
      directlyRequested: true,
      includeReviewGated: false,
    });
  });

  it("never forwards a hallucinated includeReviewGated flag (owner-only review stays off)", async () => {
    searchSemanticContext.mockResolvedValue([]);

    await tool.execute(
      // A model that hallucinates the owner-only review flag must not be honored: the
      // tool pins it off, so un-accepted suggested proposals can never leak into a chat.
      { query: "water filter", includeReviewGated: true } as never,
      ctx,
    );

    expect(searchSemanticContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeReviewGated: false }),
    );
  });

  it("includes visibility provenance in model-facing semantic recall summaries", () => {
    const toModelOutput = tool.toModelOutput;
    if (!toModelOutput) {
      throw new Error("Expected search_semantic_context to define toModelOutput.");
    }

    const output = toModelOutput({
      results: [
        {
          recordKind: "source_record",
          recordId: "source-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Household context about Mara.",
          similarity: 0.82,
          trustLevel: "logged_context",
          sensitivity: "normal",
          visibilityChoice: "whole_household",
          visibilityLabel: "Whole household",
          sourceRefs: [{ kind: "source_record", id: "source-1" }],
          routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
        },
      ],
      component: { type: "semantic_context_search", resultCount: 1 },
    }) as { type: "json"; value: { results: Array<Record<string, unknown>> } };

    expect(output.value.results[0]).toMatchObject({
      visibility: "Whole household",
      visibilityChoice: "whole_household",
    });
  });

  it("fails open when the shared semantic query has no ready embeddings", async () => {
    searchSemanticContext.mockResolvedValue([]);

    const result = await tool.execute(
      {
        query: "gift ideas",
        limit: 5,
        minimumSimilarity: 0,
        directlyRequested: false,
      },
      ctx,
    );

    expect(result).toEqual({
      results: [],
      component: {
        type: "semantic_context_search",
        resultCount: 0,
      },
    });
  });
});
