import { describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { searchRelationshipContext } = vi.hoisted(() => ({
  searchRelationshipContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/relationship-context-search", () => ({
  searchRelationshipContext,
}));

const { default: rawTool } = await import("../agent/tools/search_relationship_context");
const tool = asTestTool(rawTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

describe("search_relationship_context tool", () => {
  it("calls the shared owner-scoped exact recall query", async () => {
    searchRelationshipContext.mockResolvedValue([
      {
        recordKind: "person",
        recordId: "person-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Talked about backend architecture.",
        matchedFields: ["profileBlurb"],
        rank: 1.2,
        trustLevel: "identity_reference",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
      },
    ]);

    const result = await tool.execute(
      {
        query: "backend",
        limit: 5,
        directlyRequested: false,
        includeArchived: false,
        visibilityScope: "all_visible",
      },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      query: "backend",
      limit: 5,
      directlyRequested: false,
      includeArchived: false,
      visibilityScope: "all_visible",
      // Review context is pinned off by the tool, never model-forwarded.
      includeReviewGated: false,
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        recordKind: "person",
        recordId: "person-1",
        snippet: "Talked about backend architecture.",
        trustLevel: "identity_reference",
      }),
    );
    expect(result).not.toHaveProperty("person");
    expect(result).not.toHaveProperty("snapshot");
  });

  it("returns compact typed references without full profiles or snapshot prose", async () => {
    searchRelationshipContext.mockResolvedValue([
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Mara prefers backend architecture conversations.",
        matchedFields: ["content"],
        rank: 1.1,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        fullProfile: "Do not expose full profiles through exact recall.",
        snapshot: { summary: "Generated snapshot prose must not become recall truth." },
      },
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Logged lunch about backend architecture.",
        matchedFields: ["content"],
        rank: 0.9,
        trustLevel: "logged_context",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        snapshotStatus: "fresh",
      },
    ]);

    const result = await tool.execute(
      {
        query: "backend architecture",
        limit: 5,
        directlyRequested: false,
        includeArchived: false,
        visibilityScope: "all_visible",
      },
      ctx,
    );

    expect(result.results).toEqual([
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Mara prefers backend architecture conversations.",
        matchedFields: ["content"],
        rank: 1.1,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
      },
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Logged lunch about backend architecture.",
        matchedFields: ["content"],
        rank: 0.9,
        trustLevel: "logged_context",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
      },
    ]);
    expect(result).not.toHaveProperty("person");
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("snapshot");
    expect(JSON.stringify(result)).not.toContain("snapshotStatus");
  });

  it("keeps exact recall distinct from identity lookup and context loading", async () => {
    searchRelationshipContext.mockResolvedValue([]);

    await tool.execute(
      {
        query: "backend",
        recordKinds: ["person", "memory", "source_record"],
        limit: 8,
        directlyRequested: false,
        includeArchived: false,
        visibilityScope: "all_visible",
      },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenLastCalledWith({
      ownerUserId: "user-1",
      query: "backend",
      recordKinds: ["person", "memory", "source_record"],
      limit: 8,
      directlyRequested: false,
      includeArchived: false,
      visibilityScope: "all_visible",
      includeReviewGated: false,
    });
  });

  it("includes visibility provenance in model-facing exact recall summaries", () => {
    const toModelOutput = tool.toModelOutput;
    if (!toModelOutput) {
      throw new Error("Expected search_relationship_context to define toModelOutput.");
    }

    const output = toModelOutput({
      results: [
        {
          recordKind: "memory",
          recordId: "memory-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Mara shared a household update.",
          matchedFields: ["content"],
          rank: 1,
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
          visibilityChoice: "selected_members",
          visibilityLabel: "Specific people",
        },
      ],
      component: { type: "relationship_context_search", resultCount: 1 },
    }) as { type: "json"; value: { results: Array<Record<string, unknown>> } };

    expect(output.value.results[0]).toMatchObject({
      visibility: "Specific people",
      visibilityChoice: "selected_members",
    });
  });

  it("removes private and identity records before shared results reach the model", async () => {
    const result = (
      visibilityChoice: "only_me" | "selected_members" | "whole_household" | null,
    ) => ({
      recordKind: visibilityChoice === null ? ("person" as const) : ("memory" as const),
      recordId: `record-${visibilityChoice ?? "identity"}`,
      relatedPersonId: "person-1",
      relatedPersonDisplayName: "Mara Lin",
      label: "Mara Lin",
      snippet: `Context marked ${visibilityChoice ?? "identity"}`,
      matchedFields: ["content"],
      rank: 1,
      trustLevel:
        visibilityChoice === null ? ("identity_reference" as const) : ("confirmed_fact" as const),
      sensitivity: "normal" as const,
      visibilityChoice,
      visibilityLabel:
        visibilityChoice === "only_me"
          ? "Only me"
          : visibilityChoice === "selected_members"
            ? "Specific people"
            : visibilityChoice === "whole_household"
              ? "Whole household"
              : null,
    });
    searchRelationshipContext.mockResolvedValue([
      result("only_me"),
      result("selected_members"),
      result("whole_household"),
      result(null),
    ]);

    const output = await tool.execute(
      {
        query: "Mara",
        limit: 8,
        directlyRequested: false,
        includeArchived: false,
        visibilityScope: "shared",
      },
      ctx,
    );

    expect(output.results.map((entry) => entry.visibilityChoice)).toEqual([
      "selected_members",
      "whole_household",
    ]);
    expect(output.component.resultCount).toBe(2);
    const modelOutput = JSON.stringify(tool.toModelOutput?.(output));
    expect(modelOutput).not.toContain("only_me");
    expect(modelOutput).not.toContain("identity");
  });

  it("forwards direct restricted requests without using search_people", async () => {
    searchRelationshipContext.mockResolvedValue([]);

    await tool.execute(
      {
        query: "delicate",
        recordKinds: ["person"],
        limit: 3,
        directlyRequested: true,
        includeArchived: false,
        visibilityScope: "all_visible",
      },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenLastCalledWith({
      ownerUserId: "user-1",
      query: "delicate",
      recordKinds: ["person"],
      limit: 3,
      directlyRequested: true,
      includeArchived: false,
      visibilityScope: "all_visible",
      includeReviewGated: false,
    });
  });
});
