import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryAssetStore } from "./in-memory-store";
import { createAssetLifecycle } from "./lifecycle";

const OWNER = "user-1";
// Household actors: OWNER owns the household, MEMBER and OTHER_MEMBER are active
// members, OUTSIDER belongs to no household.
const MEMBER = "user-member";
const OTHER_MEMBER = "user-other-member";
const OUTSIDER = "user-outsider";

/**
 * The single sentence every refusal produces. "No such asset", "you may not",
 * and "you were removed from that household" have to be indistinguishable from
 * outside, because the difference between them is the protected fact (ADR 0219).
 */
const UNAVAILABLE = /no longer available/;

function setup() {
  const store = createInMemoryAssetStore();
  const lifecycle = createAssetLifecycle(store);

  function seedAsset(
    overrides: Partial<Parameters<typeof lifecycle.createAsset>[0]> = {},
  ): ReturnType<typeof lifecycle.createAsset> {
    return lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
      ...overrides,
    });
  }

  async function seedHousehold() {
    return seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
        [OTHER_MEMBER, "member"],
      ],
    });
  }

  const auditKinds = async (assetId: string) =>
    (await lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId })).map((event) => event.kind);

  return { store, lifecycle, seedAsset, seedHousehold, auditKinds };
}

describe("create asset", () => {
  it("creates an active, private asset with provenance and a created audit event", async () => {
    const { lifecycle } = setup();

    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
    });

    expect(asset.status).toBe("active");
    expect(asset.scope).toBe("private");
    expect(asset.householdId).toBeNull();
    expect(asset.archivedAt).toBeNull();
    expect(asset.ownerUserId).toBe(OWNER);
    expect(asset.createdByUserId).toBe(OWNER);
    expect(asset.lastActorUserId).toBe(OWNER);
    expect(asset.name).toBe("Kitchen refrigerator");
    expect(asset.kind).toBe("appliance");

    const audit = await lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.kind).toBe("created");
    expect(audit[0]?.actorUserId).toBe(OWNER);
    expect(audit[0]?.source).toBe("user");
    expect(audit[0]?.scope).toBe("private");
    expect(audit[0]?.detailJson).toMatchObject({ name: "Kitchen refrigerator", kind: "appliance" });
  });

  it("rejects a blank name", async () => {
    const { lifecycle } = setup();
    await expect(
      lifecycle.createAsset({ ownerUserId: OWNER, name: "   ", kind: "item" }),
    ).rejects.toThrow();
  });

  it("rejects a household scope without a household", async () => {
    const { seedAsset } = setup();
    await expect(seedAsset({ scope: "household", householdId: null })).rejects.toThrow(
      AssetValidationError,
    );
  });

  it("rejects a shared scope with no selected members", async () => {
    const { seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    await expect(
      seedAsset({ scope: "shared", householdId: household.id, selectedUserIds: [] }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("records the audit source for non-user writes", async () => {
    const { lifecycle } = setup();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Water softener",
      kind: "appliance",
      source: "system",
    });
    const audit = await lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id });
    expect(audit[0]?.source).toBe("system");
  });
});

describe("asset visibility", () => {
  it("keeps a private asset invisible to household members (deterministic denial)", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    await seedHousehold();
    const asset = await seedAsset();

    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: asset.id }),
    ).resolves.toBeNull();
    const memberList = await lifecycle.listAssets({ callerUserId: MEMBER });
    expect(memberList).toHaveLength(0);
  });

  it("makes a household asset visible to active members but not outsiders", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({ scope: "household", householdId: household.id });

    const forMember = await lifecycle.getAsset({ callerUserId: MEMBER, assetId: asset.id });
    expect(forMember?.id).toBe(asset.id);
    await expect(
      lifecycle.getAsset({ callerUserId: OUTSIDER, assetId: asset.id }),
    ).resolves.toBeNull();
  });

  it("shows a shared asset only to selected members", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });

    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: asset.id }),
    ).resolves.toMatchObject({ id: asset.id });
    await expect(
      lifecycle.getAsset({ callerUserId: OTHER_MEMBER, assetId: asset.id }),
    ).resolves.toBeNull();
  });

  it("drops visibility when a member is removed from the household", async () => {
    const { store, lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({ scope: "household", householdId: household.id });

    await removeHouseholdMember(store, { householdId: household.id, userId: MEMBER });

    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: asset.id }),
    ).resolves.toBeNull();
  });
});

describe("list assets", () => {
  it("lists the caller's visible assets ordered by name, filterable by kind/status/scope", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const fridge = await seedAsset({ name: "Refrigerator", kind: "appliance" });
    const car = await seedAsset({ name: "Corolla", kind: "vehicle" });
    const streaming = await seedAsset({
      name: "Streaming plan",
      kind: "subscription",
      scope: "household",
      householdId: household.id,
    });
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: car.id });

    const all = await lifecycle.listAssets({ callerUserId: OWNER });
    expect(all.map((asset) => asset.name)).toEqual(["Corolla", "Refrigerator", "Streaming plan"]);

    const active = await lifecycle.listAssets({ callerUserId: OWNER, statuses: ["active"] });
    expect(active.map((asset) => asset.id)).toEqual([fridge.id, streaming.id]);

    const appliances = await lifecycle.listAssets({ callerUserId: OWNER, kinds: ["appliance"] });
    expect(appliances.map((asset) => asset.id)).toEqual([fridge.id]);

    const householdOnly = await lifecycle.listAssets({
      callerUserId: OWNER,
      scopes: ["household"],
    });
    expect(householdOnly.map((asset) => asset.id)).toEqual([streaming.id]);

    // The household member sees only the household-scoped asset — scope filtering
    // is applied pre-retrieval, never post-hoc.
    const forMember = await lifecycle.listAssets({ callerUserId: MEMBER });
    expect(forMember.map((asset) => asset.id)).toEqual([streaming.id]);
  });

  it("pages the stable visible ordering without widening scope", async () => {
    const { lifecycle, seedAsset } = setup();
    await seedAsset({ name: "Alpha" });
    await seedAsset({ name: "Bravo" });
    await seedAsset({ name: "Charlie" });
    await seedAsset({ name: "Delta" });

    const page = await lifecycle.listAssets({ callerUserId: OWNER, limit: 2, offset: 1 });

    expect(page.map((asset) => asset.name)).toEqual(["Bravo", "Charlie"]);
  });
});

describe("edit asset", () => {
  it("renames an asset and records an edited audit event with before/after values", async () => {
    const { lifecycle, seedAsset, auditKinds } = setup();
    const asset = await seedAsset();

    const updated = await lifecycle.editAsset({
      actorUserId: OWNER,
      assetId: asset.id,
      edit: { name: "Fridge water filter (MWF)" },
    });

    expect(updated.name).toBe("Fridge water filter (MWF)");
    expect(updated.lastActorUserId).toBe(OWNER);
    await expect(auditKinds(asset.id)).resolves.toEqual(["created", "edited"]);

    const audit = await lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id });
    expect(audit.at(-1)?.detailJson).toEqual({
      nameFrom: "Refrigerator water filter",
      nameTo: "Fridge water filter (MWF)",
    });
  });

  it("records a kind change in the audit detail as before/after values", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();

    await lifecycle.editAsset({ actorUserId: OWNER, assetId: asset.id, edit: { kind: "item" } });

    const audit = await lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id });
    expect(audit.at(-1)?.detailJson).toEqual({ kindFrom: "appliance", kindTo: "item" });
  });

  it("rejects an empty edit", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await expect(
      lifecycle.editAsset({ actorUserId: OWNER, assetId: asset.id, edit: {} }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("rejects editing an archived asset", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });

    await expect(
      lifecycle.editAsset({ actorUserId: OWNER, assetId: asset.id, edit: { name: "New name" } }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("is owner-only: a household member who can see the asset cannot edit it", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({ scope: "household", householdId: household.id });

    // Widening visibility never transfers authority (ADR 0214), and the refusal
    // is the one opaque sentence rather than "you may not" (ADR 0219).
    await expect(
      lifecycle.editAsset({ actorUserId: MEMBER, assetId: asset.id, edit: { name: "Nope" } }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});

describe("hard delete asset", () => {
  it("permanently removes an owned asset and its audit trail", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();

    await lifecycle.hardDeleteAsset({ actorUserId: OWNER, assetId: asset.id });

    await expect(
      lifecycle.getAsset({ callerUserId: OWNER, assetId: asset.id }),
    ).resolves.toBeNull();
    await expect(
      lifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id }),
    ).resolves.toEqual([]);
  });

  it("does not let a household member hard-delete another owner's asset", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({ scope: "household", householdId: household.id });

    await expect(
      lifecycle.hardDeleteAsset({ actorUserId: MEMBER, assetId: asset.id }),
    ).rejects.toThrow(UNAVAILABLE);
    await expect(
      lifecycle.getAsset({ callerUserId: OWNER, assetId: asset.id }),
    ).resolves.toMatchObject({ id: asset.id });
  });
});

describe("archive and restore", () => {
  it("archives an active asset with an archive timestamp and audit event", async () => {
    const { lifecycle, seedAsset, auditKinds } = setup();
    const asset = await seedAsset();

    const archived = await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(auditKinds(asset.id)).resolves.toEqual(["created", "archived"]);
  });

  it("restores an archived asset and clears the archive timestamp", async () => {
    const { lifecycle, seedAsset, auditKinds } = setup();
    const asset = await seedAsset();
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });

    const restored = await lifecycle.restoreAsset({ actorUserId: OWNER, assetId: asset.id });

    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    await expect(auditKinds(asset.id)).resolves.toEqual(["created", "archived", "restored"]);
  });

  it("rejects archiving twice", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });
    await expect(lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id })).rejects.toThrow(
      AssetValidationError,
    );
  });

  it("keeps archiving a member's own asset with them, however wide its audience", async () => {
    const { lifecycle, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await seedAsset({ scope: "household", householdId: household.id });

    // Phase Eight narrows what Phase 6 allowed here: setting someone's record
    // aside for them was never the audience's to do, and it is the one authority
    // question archive and restore share (ADR 0214, #386).
    await expect(
      lifecycle.archiveAsset({ actorUserId: MEMBER, assetId: asset.id }),
    ).rejects.toThrow(UNAVAILABLE);

    const archived = await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });
    expect(archived.status).toBe("archived");
    expect(archived.lastActorUserId).toBe(OWNER);
  });

  it("denies archive to a caller who cannot see the asset (indistinguishable from missing)", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await expect(
      lifecycle.archiveAsset({ actorUserId: OUTSIDER, assetId: asset.id }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});

describe("asset audit reads", () => {
  it("is owner-scoped: another user reads an empty trail", async () => {
    const { lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await expect(
      lifecycle.listAssetAudit({ ownerUserId: OUTSIDER, assetId: asset.id }),
    ).resolves.toEqual([]);
  });
});
