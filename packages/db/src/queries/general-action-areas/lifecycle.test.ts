import { DEFAULT_GENERAL_ACTION_AREA_NAMES } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionAreaStore } from "./in-memory-store";
import { createGeneralActionAreaManager } from "./lifecycle";

const OWNER = "user-1";
const OTHER = "user-2";

function setup() {
  const store = createInMemoryGeneralActionAreaStore();
  const manager = createGeneralActionAreaManager(store);
  return { store, manager };
}

describe("default areas", () => {
  it("seeds the sensible defaults on first use, in their curated order", async () => {
    const { manager } = setup();

    const areas = await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    expect(areas.map((area) => area.name)).toEqual([...DEFAULT_GENERAL_ACTION_AREA_NAMES]);
    expect(areas.every((area) => area.archivedAt === null)).toBe(true);
  });

  it("is idempotent — a second call does not re-seed", async () => {
    const { manager } = setup();
    await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    const areas = await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    expect(areas).toHaveLength(DEFAULT_GENERAL_ACTION_AREA_NAMES.length);
  });

  it("does not re-seed after the owner has archived every default", async () => {
    const { manager } = setup();
    const seeded = await manager.ensureDefaultAreas({ ownerUserId: OWNER });
    for (const area of seeded) {
      await manager.archiveArea({ ownerUserId: OWNER, areaId: area.id });
    }

    // Re-running finds rows (archived) so it stays a no-op; active list is empty.
    const active = await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    expect(active).toEqual([]);
    await expect(
      manager.listAreas({ ownerUserId: OWNER, includeArchived: true }),
    ).resolves.toHaveLength(DEFAULT_GENERAL_ACTION_AREA_NAMES.length);
  });
});

describe("custom area lifecycle", () => {
  it("creates a flat custom area appended after existing ones", async () => {
    const { manager } = setup();
    await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    const created = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    const areas = await manager.listAreas({ ownerUserId: OWNER });
    expect(areas.at(-1)?.name).toBe("Garden");
    expect(created.sortOrder).toBe(DEFAULT_GENERAL_ACTION_AREA_NAMES.length);
    // Flat: a created Area carries no parent/child linkage — just a name and order.
    expect(Object.keys(created)).not.toContain("parentId");
  });

  it("trims the name and rejects a blank one", async () => {
    const { manager } = setup();

    const created = await manager.createArea({ ownerUserId: OWNER, name: "  Garage  " });
    expect(created.name).toBe("Garage");

    await expect(manager.createArea({ ownerUserId: OWNER, name: "   " })).rejects.toThrow();
  });

  it("rejects a duplicate name case-insensitively", async () => {
    const { manager } = setup();
    await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    await expect(manager.createArea({ ownerUserId: OWNER, name: "garden" })).rejects.toThrow(
      /already have an area with that name/,
    );
  });

  it("renames an area and keeps names distinct", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });
    await manager.createArea({ ownerUserId: OWNER, name: "Garage" });

    const renamed = await manager.renameArea({
      ownerUserId: OWNER,
      areaId: garden.id,
      name: "Yard",
    });
    expect(renamed.name).toBe("Yard");

    // Cannot rename onto another active area's name.
    await expect(
      manager.renameArea({ ownerUserId: OWNER, areaId: garden.id, name: "Garage" }),
    ).rejects.toThrow(/already have an area with that name/);
  });

  it("lets an area keep its own name on rename (no self-collision)", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    const renamed = await manager.renameArea({
      ownerUserId: OWNER,
      areaId: garden.id,
      name: "Garden",
    });

    expect(renamed.name).toBe("Garden");
  });
});

describe("archiving", () => {
  it("archives an area so it drops out of the active list but persists", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    const archived = await manager.archiveArea({ ownerUserId: OWNER, areaId: garden.id });
    expect(archived.archivedAt).toBeInstanceOf(Date);

    await expect(manager.listAreas({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(
      manager.listAreas({ ownerUserId: OWNER, includeArchived: true }),
    ).resolves.toHaveLength(1);
  });

  it("frees an archived name for reuse and rejects re-archiving", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });
    await manager.archiveArea({ ownerUserId: OWNER, areaId: garden.id });

    // The archived name is free again...
    const fresh = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });
    expect(fresh.id).not.toBe(garden.id);

    // ...but a retired area cannot be renamed or archived again.
    await expect(manager.archiveArea({ ownerUserId: OWNER, areaId: garden.id })).rejects.toThrow(
      /archived/,
    );
    await expect(
      manager.renameArea({ ownerUserId: OWNER, areaId: garden.id, name: "Anything" }),
    ).rejects.toThrow(/archived/);
  });

  it("unarchives an area back into the active list", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });
    await manager.archiveArea({ ownerUserId: OWNER, areaId: garden.id });

    const restored = await manager.unarchiveArea({ ownerUserId: OWNER, areaId: garden.id });

    expect(restored.archivedAt).toBeNull();
    await expect(manager.listAreas({ ownerUserId: OWNER })).resolves.toMatchObject([
      { id: garden.id },
    ]);
  });

  it("rejects unarchiving an area that isn't archived", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    await expect(manager.unarchiveArea({ ownerUserId: OWNER, areaId: garden.id })).rejects.toThrow(
      /isn't archived/,
    );
  });

  it("rejects unarchiving when an active area now holds the name", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });
    await manager.archiveArea({ ownerUserId: OWNER, areaId: garden.id });
    // A new active area claims the freed name.
    await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    await expect(manager.unarchiveArea({ ownerUserId: OWNER, areaId: garden.id })).rejects.toThrow(
      /already have an area with that name/,
    );
  });
});

describe("owner scoping", () => {
  it("hides another owner's areas from reads and mutations", async () => {
    const { manager } = setup();
    const garden = await manager.createArea({ ownerUserId: OWNER, name: "Garden" });

    await expect(manager.getArea({ ownerUserId: OTHER, areaId: garden.id })).rejects.toThrow(
      /Area not found/,
    );
    await expect(manager.archiveArea({ ownerUserId: OTHER, areaId: garden.id })).rejects.toThrow(
      /Area not found/,
    );
    await expect(manager.listAreas({ ownerUserId: OTHER })).resolves.toEqual([]);
  });

  it("seeds defaults independently per owner", async () => {
    const { manager } = setup();
    await manager.ensureDefaultAreas({ ownerUserId: OWNER });

    const other = await manager.ensureDefaultAreas({ ownerUserId: OTHER });

    expect(other.map((area) => area.name)).toEqual([...DEFAULT_GENERAL_ACTION_AREA_NAMES]);
  });
});
