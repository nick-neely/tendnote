import { randomUUID } from "node:crypto";
import {
  createGeneralActionAreaSchema,
  type GeneralActionArea,
  generalActionAreaSchema,
  normalizeAreaName,
} from "@tendnote/domain";
import type { GeneralActionAreaStore } from "./types";

/**
 * Minimal owner-scoped Area store over one map. It carries only Area methods so it
 * can be composed into the General Action lifecycle store (for Area-assignment
 * verification) without shadowing that store's methods, mirroring the source-record
 * store composition.
 */
export function createInMemoryGeneralActionAreaStore(): GeneralActionAreaStore {
  const areas = new Map<string, GeneralActionArea>();

  /** Whether the owner already has an *active* Area with this normalized name. */
  function activeNameTaken(ownerUserId: string, name: string): boolean {
    const normalized = normalizeAreaName(name);
    return [...areas.values()].some(
      (area) =>
        area.ownerUserId === ownerUserId &&
        area.archivedAt === null &&
        normalizeAreaName(area.name) === normalized,
    );
  }

  function insert(values: Parameters<GeneralActionAreaStore["createArea"]>[0]): GeneralActionArea {
    const parsed = createGeneralActionAreaSchema.parse(values);
    const now = new Date();
    const area: GeneralActionArea = {
      ...parsed,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    areas.set(area.id, area);

    return area;
  }

  return {
    async createArea(values) {
      return insert(values);
    },
    async createAreas(input) {
      // Mirror the drizzle store's on-conflict-do-nothing against the partial unique
      // index: skip any that would collide with an existing active name.
      const created: GeneralActionArea[] = [];
      for (const values of input.areas) {
        if (values.archivedAt == null && activeNameTaken(values.ownerUserId, values.name)) {
          continue;
        }
        created.push(insert(values));
      }
      return created;
    },
    async getArea(input) {
      const area = areas.get(input.areaId);

      if (!area || area.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return area;
    },
    async updateArea(input) {
      const area = areas.get(input.areaId);

      if (!area || area.ownerUserId !== input.ownerUserId) {
        throw new Error("Area not found.");
      }

      // Re-validate the merged record so field constraints hold for direct store
      // callers too, matching the drizzle store.
      const updated = generalActionAreaSchema.parse({
        ...area,
        ...input.patch,
        updatedAt: new Date(),
      });

      areas.set(updated.id, updated);

      return updated;
    },
    async listAreasForOwner(input) {
      return [...areas.values()]
        .filter(
          (area) =>
            area.ownerUserId === input.ownerUserId &&
            (input.includeArchived === true || area.archivedAt === null),
        )
        .sort(bySortThenName);
    },
  };
}

/**
 * Orders Areas by `sortOrder` ascending, then name — the shared ordering contract
 * both stores implement so the filter and picker read identically. Seeded defaults
 * keep their curated order; custom Areas append after.
 */
function bySortThenName(a: GeneralActionArea, b: GeneralActionArea): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  return a.name.localeCompare(b.name);
}
