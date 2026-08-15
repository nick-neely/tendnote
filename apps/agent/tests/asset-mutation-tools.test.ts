import { AssetValidationError, HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, toolModelValue } from "./test-tool";

const { createAsset, editAsset } = vi.hoisted(() => ({
  createAsset: vi.fn(),
  editAsset: vi.fn(),
}));
vi.mock("@tendnote/db/queries/assets", () => ({ createAsset, editAsset }));

const { requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawCreateTool } = await import("../agent/tools/create_asset");
const { default: rawEditTool } = await import("../agent/tools/edit_asset");
const createTool = asTestTool(rawCreateTool);
const editTool = asTestTool(rawEditTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const SCOPES = [{ kind: "viewer-collection", collection: "assets", viewerUserId: "user-1" }];

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    ownerUserId: "user-1",
    name: "Kitchen refrigerator",
    kind: "appliance",
    status: "active",
    scope: "private",
    ownership: "member_owned",
    householdId: null,
    archivedAt: null,
    revision: 0,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("create_asset", () => {
  it("creates for the session's owner, private, with assistant provenance", async () => {
    createAsset.mockResolvedValue({ result: asset(), affectedScopes: SCOPES });

    await createTool.execute({ name: "Kitchen refrigerator", kind: "appliance" }, ctx);

    // The whole shape of the call: the owner comes from the session, and no scope,
    // household, ownership, or member selection is offered to the seam - the private
    // default is the Asset's ceiling for every child record (ADR 0179).
    expect(createAsset).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Kitchen refrigerator",
      kind: "appliance",
      source: "assistant",
    });
  });

  it("reconciles the scopes the write affected", async () => {
    createAsset.mockResolvedValue({ result: asset(), affectedScopes: SCOPES });

    await createTool.execute({ name: "Kitchen refrigerator", kind: "appliance" }, ctx);

    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
  });

  it("hands the model the id it needs and tells it nothing was recorded about the thing", async () => {
    createAsset.mockResolvedValue({ result: asset(), affectedScopes: SCOPES });

    const output = await createTool.execute(
      { name: "Kitchen refrigerator", kind: "appliance" },
      ctx,
    );
    const value = toolModelValue(createTool, output) as {
      asset: { assetId: string; name: string };
      guidance: string;
    };

    // The id travels because propose_asset_memories and friends take one; the write
    // fence does not, because a model quoting a stale revision manufactures conflicts.
    expect(value.asset.assetId).toBe(ASSET_ID);
    expect(JSON.stringify(value)).not.toContain("revision");
    expect(value.guidance).toMatch(/still go up for review/i);
  });

  it("curates a store failure instead of handing the model raw SQL", async () => {
    createAsset.mockRejectedValue(new Error('Failed query: insert into "assets" ...'));

    await expect(
      createTool.execute({ name: "Kitchen refrigerator", kind: "appliance" }, ctx),
    ).rejects.toThrow(/Could not read the user's records right now/);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

describe("edit_asset", () => {
  it("edits the resolved asset as the session's caller, changing only what was passed", async () => {
    editAsset.mockResolvedValue({
      result: asset({ name: "Garage fridge" }),
      affectedScopes: SCOPES,
    });

    await editTool.execute({ assetId: ASSET_ID, name: "Garage fridge" }, ctx);

    expect(editAsset).toHaveBeenCalledWith({
      actorUserId: "user-1",
      assetId: ASSET_ID,
      edit: { name: "Garage fridge" },
      source: "assistant",
    });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith(SCOPES);
  });

  it("refuses an edit that changes nothing rather than reporting a change", async () => {
    await expect(editTool.execute({ assetId: ASSET_ID }, ctx)).rejects.toBeInstanceOf(
      AssetValidationError,
    );
    expect(editAsset).not.toHaveBeenCalled();
  });

  it("passes the household proof's one opaque refusal through unchanged", async () => {
    // A refused proof, a missing asset, and an ended membership are the same sentence
    // from outside, and the tool must not turn it into an infrastructure error.
    editAsset.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(
      editTool.execute({ assetId: ASSET_ID, name: "Garage fridge" }, ctx),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});
