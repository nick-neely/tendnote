import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { searchGlobalRecall } = vi.hoisted(() => ({ searchGlobalRecall: vi.fn() }));
vi.mock("@tendnote/db/queries/global-recall", () => ({ searchGlobalRecall }));

const { default: rawTool } = await import("../agent/tools/search_global_recall");
const tool = asTestTool(rawTool);
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

beforeEach(() => vi.clearAllMocks());

describe("search_global_recall", () => {
  it("uses the shared owner-scoped seam and preserves citations and limitations", async () => {
    searchGlobalRecall.mockResolvedValue({
      query: "fridge filter",
      results: [
        {
          family: "asset_memory",
          canonical: { kind: "asset_memory", id: "memory-1" },
          label: "Filter size",
          supportingText: "RPWFE",
          lifecycle: "active",
          match: { kind: "exact", reason: "Matched an exact Asset value", excerpt: "RPWFE" },
          trust: "asset_fact",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [
            { kind: "asset_memory", id: "memory-1" },
            { kind: "asset_evidence", id: "evidence-1" },
          ],
          href: "/assets/asset-1?focus=memory-1",
          parent: { kind: "asset", id: "asset-1" },
          details: {
            assetId: "asset-1",
            assetName: "Fridge",
            assetKind: "appliance",
            value: { type: "text", text: "RPWFE" },
          },
        },
      ],
      limitations: [{ source: "calendar", message: "Calendar results are unavailable." }],
      hasMore: false,
    });

    const output = await tool.execute(
      {
        query: "fridge filter",
        family: "all",
        limit: 12,
        includeArchived: false,
        includeRestricted: false,
      },
      ctx,
    );
    expect(searchGlobalRecall).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", query: "fridge filter" }),
      { readerFor: expect.any(Function) },
    );
    const model = tool.toModelOutput?.(output) as { value: Record<string, unknown> };
    expect(model.value).toMatchObject({
      limitations: [{ source: "calendar" }],
      results: [
        {
          canonical: { kind: "asset_memory", id: "memory-1" },
          href: "/assets/asset-1?focus=memory-1",
          citations: [
            { kind: "asset_memory", id: "memory-1" },
            { kind: "asset_evidence", id: "evidence-1" },
          ],
        },
      ],
    });
  });

  it("preserves Calendar reconnect guidance through model output", async () => {
    searchGlobalRecall.mockResolvedValue({
      query: "Maya calendar",
      results: [],
      limitations: [
        {
          source: "calendar",
          requiresReauthorization: true,
          message:
            "Google Calendar authorization needs to be renewed. Reconnect Google Calendar from your account page, then try again.",
        },
      ],
      hasMore: false,
    });

    const output = await tool.execute(
      {
        query: "Maya calendar",
        family: "all",
        limit: 12,
        includeArchived: false,
        includeRestricted: false,
      },
      ctx,
    );
    const model = tool.toModelOutput?.(output) as {
      value: { limitations: Array<Record<string, unknown>> };
    };

    expect(model.value.limitations).toEqual([
      {
        source: "calendar",
        requiresReauthorization: true,
        message:
          "Google Calendar authorization needs to be renewed. Reconnect Google Calendar from your account page, then try again.",
      },
    ]);
  });
});
