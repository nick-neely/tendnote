import { AssetValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchAssets } = vi.hoisted(() => ({ searchAssets: vi.fn() }));
const { getAssetSnapshot } = vi.hoisted(() => ({ getAssetSnapshot: vi.fn() }));
const { proposeAssetMemoryActions } = vi.hoisted(() => ({
  proposeAssetMemoryActions: vi.fn(),
}));
const { suggestAsset, suggestAssetMemories } = vi.hoisted(() => ({
  suggestAsset: vi.fn(),
  suggestAssetMemories: vi.fn(),
}));
const { captureSourceRecord } = vi.hoisted(() => ({ captureSourceRecord: vi.fn() }));

vi.mock("@tendnote/db/queries/asset-search", () => ({ searchAssets }));
vi.mock("@tendnote/db/queries/asset-snapshots", () => ({ getAssetSnapshot }));
vi.mock("@tendnote/db/queries/assets", () => ({
  proposeAssetMemoryActions,
  suggestAsset,
  suggestAssetMemories,
}));
vi.mock("@tendnote/db/queries/source-records", () => ({ captureSourceRecord }));

const { default: searchAssetsTool } = await import("../agent/tools/search_assets");
const { default: getAssetContextTool } = await import("../agent/tools/get_asset_context");
const { default: proposeAssetActionsTool } = await import("../agent/tools/propose_asset_actions");
const { default: proposeAssetMemoriesTool, MAX_ASSET_MEMORY_PROPOSALS } = await import(
  "../agent/tools/propose_asset_memories"
);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * What a drizzle failure actually looks like: the failed SQL *and the bound parameters*
 * are the error's message. This is the string that reached the model verbatim when Eve
 * guessed an asset name as an id, and no tool may ever hand it back.
 */
const LEAKY_STORE_ERROR = new Error(
  'Failed query: select "id", "owner_user_id" from "assets" where "assets"."id" = $1 ' +
    "params: Kitchen refrigerator,demo-user,1",
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** `inputSchema` is the zod object at runtime (the Standard-schema type hides safeParse). */
function inputParser(tool: { inputSchema: unknown }) {
  return tool.inputSchema as { safeParse: (value: unknown) => { success: boolean } };
}

function assetMemoryResult(overrides: Record<string, unknown> = {}) {
  return {
    recordKind: "asset_memory",
    recordId: MEMORY_ID,
    assetId: ASSET_ID,
    assetName: "Refrigerator",
    assetKind: "appliance",
    assetStatus: "active",
    label: "Filter size",
    snippet: "Filter size: RPWFE",
    matchedFields: ["value"],
    matchKinds: ["structured"],
    score: 1,
    value: { type: "text", text: "RPWFE" },
    trustLevel: "asset_fact",
    visibilityChoice: "whole_household",
    visibilityLabel: "Whole household",
    citations: [
      { kind: "asset_memory", id: MEMORY_ID },
      { kind: "asset", id: ASSET_ID },
    ],
    ...overrides,
  };
}

describe("search_assets tool", () => {
  it("calls the shared owner-scoped Asset Search seam", async () => {
    searchAssets.mockResolvedValue([assetMemoryResult()]);

    const result = await searchAssetsTool.execute(
      { query: "what filter does the fridge need?", limit: 8, includeArchived: false },
      ctx,
    );

    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        query: "what filter does the fridge need?",
      }),
    );
    expect(result.results).toHaveLength(1);
  });

  it("never forwards a review-gated flag from the model — proposals stay owner-only", async () => {
    searchAssets.mockResolvedValue([]);

    await searchAssetsTool.execute(
      // A hallucinated flag must not survive: review context is a caller decision.
      { query: "fridge", includeReviewGated: true } as never,
      ctx,
    );

    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({ includeReviewGated: false }),
    );
  });

  it("re-parses store output, so an injected 'answer' field cannot reach the model", async () => {
    searchAssets.mockResolvedValue([
      { ...assetMemoryResult(), generatedAnswer: "The filter is definitely XWFE." },
    ]);

    const result = await searchAssetsTool.execute(
      { query: "fridge filter", limit: 8, includeArchived: false },
      ctx,
    );

    expect(result.results[0]).not.toHaveProperty("generatedAnswer");
  });

  it("gives the model the exact stored value", async () => {
    searchAssets.mockResolvedValue([assetMemoryResult()]);

    const output = await searchAssetsTool.execute(
      { query: "fridge filter", limit: 8, includeArchived: false },
      ctx,
    );
    const modelView = searchAssetsTool.toModelOutput?.(output) as {
      value: { results: Array<Record<string, unknown>> };
    };
    const [entry] = modelView.value.results;

    // The exact part number is what the answer hangs on.
    expect(entry?.value).toBe("RPWFE");
    expect(entry?.trust).toBe("asset_fact");
    expect(entry?.visibility).toBe("Whole household");
  });

  /**
   * The reachability contract. `toModelOutput` REPLACES the model's view of the result,
   * so search is the *only* place an `assetId` can enter Eve's context — and
   * `get_asset_context` and `propose_asset_actions` both require one. Strip it and those
   * tools are dead code the model can only reach by inventing an id, which is exactly
   * what it did: it called `get_asset_context` with `{"assetId": "Kitchen refrigerator"}`.
   */
  it("hands the model the ids its follow-up tools require", async () => {
    searchAssets.mockResolvedValue([assetMemoryResult()]);

    const output = await searchAssetsTool.execute(
      { query: "fridge filter", limit: 8, includeArchived: false },
      ctx,
    );
    const modelView = searchAssetsTool.toModelOutput?.(output) as {
      value: { results: Array<Record<string, unknown>>; guidance: string };
    };
    const [entry] = modelView.value.results;

    expect(entry?.assetId).toBe(ASSET_ID);
    // The record-level handle `propose_asset_actions` narrows by.
    expect(entry?.memoryId).toBe(MEMORY_ID);
    // Reaching a tool is not licence to print an id: the reply-side rule is carried by
    // the guidance here and by `instructions/base.md`, not by hiding the id.
    expect(modelView.value.guidance).toMatch(/never write an id in your reply/i);
  });

  it("offers a memory handle only for records that are Asset Memories", async () => {
    // An asset row's or an evidence row's id in `assetMemoryIds` is a wrong id in that
    // slot — a failed call. Only the kind that can be narrowed by gets a `memoryId`.
    searchAssets.mockResolvedValue([
      assetMemoryResult({ recordKind: "asset", recordId: ASSET_ID, value: null }),
    ]);

    const output = await searchAssetsTool.execute(
      { query: "fridge", limit: 8, includeArchived: false },
      ctx,
    );
    const modelView = searchAssetsTool.toModelOutput?.(output) as {
      value: { results: Array<Record<string, unknown>> };
    };

    expect(modelView.value.results[0]?.assetId).toBe(ASSET_ID);
    expect(modelView.value.results[0]?.memoryId).toBeNull();
  });

  it("never hands the model a raw database error", async () => {
    searchAssets.mockRejectedValue(LEAKY_STORE_ERROR);

    await expect(
      searchAssetsTool.execute({ query: "fridge", limit: 8, includeArchived: false }, ctx),
    ).rejects.toThrow(/could not read the user's records/i);
  });
});

describe("get_asset_context tool", () => {
  const snapshotContext = {
    asset: {
      id: ASSET_ID,
      ownerUserId: "user-1",
      name: "Refrigerator",
      kind: "appliance",
      status: "active",
      scope: "household",
    },
    memories: [
      {
        id: MEMORY_ID,
        label: "Filter size",
        value: { type: "text", text: "RPWFE" },
        notes: null,
        scope: "household",
      },
    ],
    evidence: [{ id: "evidence-1", kind: "manual", label: "Fridge manual" }],
    relatedAssets: [],
    personLinks: [],
    actions: [],
  };

  it("returns the reviewed facts and the snapshot as separate fields", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: { summary: "Refrigerator is an appliance you track." },
      context: snapshotContext,
    });

    const result = await getAssetContextTool.execute({ assetId: ASSET_ID }, ctx);

    expect(result.found).toBe(true);
    expect(result.facts?.[0]).toMatchObject({ label: "Filter size", value: "RPWFE" });
    // The generated prose is its own field — it can never be mistaken for a record.
    expect(result.summary).toBe("Refrigerator is an appliance you track.");
  });

  it("tells the model the snapshot is a cache, never a source of exact values", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: { summary: "Some prose." },
      context: snapshotContext,
    });

    const output = await getAssetContextTool.execute({ assetId: ASSET_ID }, ctx);
    const modelView = getAssetContextTool.toModelOutput?.(output) as {
      value: { snapshot: { available: boolean; guidance: string } };
    };

    expect(modelView.value.snapshot.available).toBe(true);
    expect(modelView.value.snapshot.guidance).toMatch(/not source of truth/i);
  });

  it("degrades to the facts alone when the snapshot is stale or missing", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: null,
      context: snapshotContext,
    });

    const output = await getAssetContextTool.execute({ assetId: ASSET_ID }, ctx);
    const modelView = getAssetContextTool.toModelOutput?.(output) as {
      value: { snapshot: { available: boolean }; facts: Array<Record<string, unknown>> };
    };

    expect(modelView.value.snapshot.available).toBe(false);
    // The truth is unaffected: the records still carry the answer.
    expect(modelView.value.facts[0]).toMatchObject({ value: "RPWFE" });
  });

  it("denies an invisible asset the same way it denies a missing one", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: null,
      context: {
        asset: null,
        memories: [],
        evidence: [],
        relatedAssets: [],
        personLinks: [],
        actions: [],
      },
    });

    const result = await getAssetContextTool.execute(
      { assetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      ctx,
    );

    expect(result.found).toBe(false);
    expect(result).not.toHaveProperty("facts");
  });

  /**
   * The malformed-id seam. A free-form `assetId` let a guessed asset *name* through to a
   * uuid column, where Postgres raised 22P02 — and the tool result the model got back was
   * the failed query text and its bound parameters. Two layers close it: the schema
   * refuses a non-uuid before the call, and the store denies one deterministically if it
   * ever gets there another way. A malformed id is `found: false`, never an error.
   */
  it("refuses an id that is not an id, before it can reach the store", () => {
    // The exact input Eve sent when it had no id to copy: the asset's *name*.
    expect(
      inputParser(getAssetContextTool).safeParse({ assetId: "Kitchen refrigerator" }).success,
    ).toBe(false);
    expect(getAssetSnapshot).not.toHaveBeenCalled();
  });

  it("never hands the model a raw database error", async () => {
    getAssetSnapshot.mockRejectedValue(LEAKY_STORE_ERROR);

    const call = getAssetContextTool.execute({ assetId: ASSET_ID }, ctx);

    await expect(call).rejects.toThrow(/could not read the user's records/i);
    // The schema, the SQL, and the user's own bound values stay out of the context.
    await expect(call).rejects.not.toThrow(/Failed query|params:|select/i);
  });
});

describe("propose_asset_actions tool", () => {
  it("proposes from the asset the model resolved, as the assistant", async () => {
    proposeAssetMemoryActions.mockResolvedValue({
      asset: { id: ASSET_ID, name: "Kitchen refrigerator" },
      proposed: [],
      alreadySpokenFor: 0,
    });

    await proposeAssetActionsTool.execute({ assetId: ASSET_ID }, ctx);

    expect(proposeAssetMemoryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        assetId: ASSET_ID,
        source: "assistant",
      }),
    );
  });

  it("refuses a guessed asset name in the id slot", () => {
    expect(
      inputParser(proposeAssetActionsTool).safeParse({ assetId: "Kitchen fridge" }).success,
    ).toBe(false);
    expect(proposeAssetMemoryActions).not.toHaveBeenCalled();
  });

  it("never hands the model a raw database error", async () => {
    proposeAssetMemoryActions.mockRejectedValue(LEAKY_STORE_ERROR);

    await expect(proposeAssetActionsTool.execute({ assetId: ASSET_ID }, ctx)).rejects.toThrow(
      /could not read the user's records/i,
    );
  });

  it("still passes a curated domain refusal through to the model", async () => {
    // The rule is not "swallow errors" — it is "only a sentence the domain wrote for a
    // person may reach the model". An archived asset must still say why it refused.
    proposeAssetMemoryActions.mockRejectedValue(
      new AssetValidationError("This asset is archived. Restore it before proposing reminders."),
    );

    await expect(proposeAssetActionsTool.execute({ assetId: ASSET_ID }, ctx)).rejects.toThrow(
      /archived/i,
    );
  });
});

/**
 * The tool Eve's instructions promised and did not have. Without it the model, told to
 * "propose an Asset Memory for review", improvised: it told the user it had *logged* the
 * ice-maker cartridge model, then had no record of it the next turn. These tests pin the
 * two things that made that a lie — that a fact reaches the store at all, and that it
 * reaches it only as a proposal.
 */
describe("propose_asset_memories tool", () => {
  const GROUP_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const SOURCE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const SAID = "The filter in my kitchen fridge is EDR1RXD1";

  function groupResult(overrides: Record<string, unknown> = {}) {
    return {
      group: { id: GROUP_ID, ownerUserId: "user-1", assetId: ASSET_ID, sourceRecordId: SOURCE_ID },
      asset: {
        id: ASSET_ID,
        name: "Kitchen refrigerator",
        kind: "appliance",
        scope: "private",
        status: "active",
      },
      assetPending: false,
      memories: [
        {
          id: MEMORY_ID,
          label: "Filter model",
          value: { type: "text", text: "EDR1RXD1" },
          notes: null,
        },
      ],
      evidence: [],
      duplicateCandidates: [],
      sourceRecord: {
        id: SOURCE_ID,
        content: SAID,
        sourceType: "agent",
        createdAt: new Date("2026-07-13T00:00:00.000Z"),
      },
      ...overrides,
    };
  }

  const detail = {
    label: "Filter model",
    value: { type: "text" as const, text: "EDR1RXD1" },
  };

  beforeEach(() => {
    captureSourceRecord.mockResolvedValue({ sourceRecord: { id: SOURCE_ID, content: SAID } });
  });

  it("anchors the fact to the asset the model resolved, as a suggestion", async () => {
    suggestAssetMemories.mockResolvedValue(groupResult());

    const output = await proposeAssetMemoriesTool.execute(
      { assetId: ASSET_ID, saidByUser: SAID, details: [detail] },
      ctx,
    );

    expect(suggestAssetMemories).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        assetId: ASSET_ID,
        sourceRecordId: SOURCE_ID,
        source: "assistant",
        memories: [{ label: "Filter model", value: detail.value, notes: null }],
      }),
    );
    // No new asset row when the user named one they already have — the #198 duplicate
    // prompt exists for the case where we *couldn't* resolve it, not as a routine.
    expect(suggestAsset).not.toHaveBeenCalled();
    expect(output.asset.pending).toBe(false);
    expect(output.pendingCount).toBe(1);
  });

  it("grounds every proposal in the user's own words (ADR 0151)", async () => {
    suggestAssetMemories.mockResolvedValue(groupResult());

    const output = await proposeAssetMemoriesTool.execute(
      { assetId: ASSET_ID, saidByUser: SAID, details: [detail] },
      ctx,
    );

    // Captured verbatim, as an assistant-written note — never `captureLoggedContext`,
    // whose person-memory and action extraction has nothing to do with a fridge filter.
    expect(captureSourceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        retainedContent: SAID,
        sourceType: "agent",
      }),
    );
    // And it rides to the review card, so the user checks the fact against what they said.
    expect(output.source?.content).toBe(SAID);
  });

  it("proposes a new (suggested) asset when there was nothing to anchor to", async () => {
    suggestAsset.mockResolvedValue(
      groupResult({
        assetPending: true,
        asset: {
          id: ASSET_ID,
          name: "Kitchen refrigerator",
          kind: "appliance",
          scope: "private",
          status: "suggested",
        },
      }),
    );

    const output = await proposeAssetMemoriesTool.execute(
      {
        newAsset: { name: "Kitchen refrigerator", kind: "appliance" as const },
        saidByUser: SAID,
        details: [detail],
      },
      ctx,
    );

    expect(suggestAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        name: "Kitchen refrigerator",
        kind: "appliance",
        sourceRecordId: SOURCE_ID,
        source: "assistant",
      }),
    );
    expect(output.asset.pending).toBe(true);
    // The anchor is itself a pending member: the user reviews the thing and the fact.
    expect(output.pendingCount).toBe(2);
  });

  it("refuses to write anything when the model named no asset at all", async () => {
    await expect(
      proposeAssetMemoriesTool.execute({ saidByUser: SAID, details: [detail] }, ctx),
    ).rejects.toThrow(/name the thing these facts belong to/i);

    // Nothing was written — not even the grounding note. A fact with nothing to hang on
    // would land in the queue as an "Untitled" husk the user has to clean up.
    expect(captureSourceRecord).not.toHaveBeenCalled();
    expect(suggestAsset).not.toHaveBeenCalled();
    expect(suggestAssetMemories).not.toHaveBeenCalled();
  });

  it("refuses a guessed asset name in the id slot", () => {
    expect(
      inputParser(proposeAssetMemoriesTool).safeParse({
        assetId: "Kitchen fridge",
        saidByUser: SAID,
        details: [detail],
      }).success,
    ).toBe(false);
  });

  it("cannot fan out into a bulk extraction pass", () => {
    const details = Array.from({ length: MAX_ASSET_MEMORY_PROPOSALS + 1 }, () => detail);

    expect(
      inputParser(proposeAssetMemoriesTool).safeParse({
        assetId: ASSET_ID,
        saidByUser: SAID,
        details,
      }).success,
    ).toBe(false);
  });

  it("tells the model, in the result itself, that nothing was saved", async () => {
    suggestAssetMemories.mockResolvedValue(groupResult());

    const output = await proposeAssetMemoriesTool.execute(
      { assetId: ASSET_ID, saidByUser: SAID, details: [detail] },
      ctx,
    );
    const modelView = proposeAssetMemoriesTool.toModelOutput?.(output) as {
      value: {
        saved: boolean;
        proposed: boolean;
        details: Array<{ value: string }>;
        guidance: string;
      };
    };

    // The exact failure this tool exists to prevent: "Got it — I've logged the filter."
    expect(modelView.value.saved).toBe(false);
    expect(modelView.value.proposed).toBe(true);
    expect(modelView.value.guidance).toMatch(/nothing was saved/i);
    expect(modelView.value.guidance).toMatch(/waiting for their review/i);
    // The part number survives the round trip exactly — it is the whole point.
    expect(modelView.value.details[0]?.value).toBe("EDR1RXD1");
  });

  it("never hands the model a raw database error", async () => {
    suggestAssetMemories.mockRejectedValue(LEAKY_STORE_ERROR);

    await expect(
      proposeAssetMemoriesTool.execute(
        { assetId: ASSET_ID, saidByUser: SAID, details: [detail] },
        ctx,
      ),
    ).rejects.toThrow(/could not read the user's records/i);
  });

  it("still passes a curated domain refusal through to the model", async () => {
    suggestAssetMemories.mockRejectedValue(
      new AssetValidationError("This asset is archived. Restore it before adding details."),
    );

    await expect(
      proposeAssetMemoriesTool.execute(
        { assetId: ASSET_ID, saidByUser: SAID, details: [detail] },
        ctx,
      ),
    ).rejects.toThrow(/archived/i);
  });
});
