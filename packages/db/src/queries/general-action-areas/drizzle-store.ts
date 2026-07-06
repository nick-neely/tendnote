import {
  createGeneralActionAreaSchema,
  generalActionAreaSchema,
  generalActionAreaUpdateSchema,
} from "@tendnote/domain";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../client";
import { generalActionAreas } from "../../schema";
import type { GeneralActionAreaStore } from "./types";

/**
 * Drizzle-backed owner-scoped Area store. Owner scoping is enforced in every
 * predicate so a caller can only read or mutate their own Areas (AGENTS.md
 * owner-scoped seams).
 */
export function createDrizzleGeneralActionAreaStore(): GeneralActionAreaStore {
  return {
    async createArea(values) {
      const [area] = await getDb()
        .insert(generalActionAreas)
        .values(createGeneralActionAreaSchema.parse(values))
        .returning();

      if (!area) {
        throw new Error("Failed to create area.");
      }

      return generalActionAreaSchema.parse(area);
    },
    async createAreas(input) {
      if (input.areas.length === 0) {
        return [];
      }

      // One atomic multi-row insert. `onConflictDoNothing` against the partial unique
      // index makes seeding idempotent and race-safe: a concurrent first-load's
      // duplicate active names are dropped rather than erroring.
      const rows = await getDb()
        .insert(generalActionAreas)
        .values(input.areas.map((values) => createGeneralActionAreaSchema.parse(values)))
        .onConflictDoNothing()
        .returning();

      return rows.map((row) => generalActionAreaSchema.parse(row));
    },
    async getArea(input) {
      const [area] = await getDb()
        .select()
        .from(generalActionAreas)
        .where(
          and(
            eq(generalActionAreas.id, input.areaId),
            eq(generalActionAreas.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return area ? generalActionAreaSchema.parse(area) : null;
    },
    async updateArea(input) {
      // Validate the patched fields so constraints hold for direct store callers. A
      // defaults-free schema is essential: a partial of the base schema would inject
      // default values for absent keys and, for example, clear `archivedAt` on a
      // plain rename.
      const patch = generalActionAreaUpdateSchema.parse(input.patch);
      const [area] = await getDb()
        .update(generalActionAreas)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(generalActionAreas.id, input.areaId),
            eq(generalActionAreas.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!area) {
        throw new Error("Area not found.");
      }

      return generalActionAreaSchema.parse(area);
    },
    async listAreasForOwner(input) {
      const rows = await getDb()
        .select()
        .from(generalActionAreas)
        .where(
          and(
            eq(generalActionAreas.ownerUserId, input.ownerUserId),
            ...(input.includeArchived === true ? [] : [isNull(generalActionAreas.archivedAt)]),
          ),
        )
        // Order by curated sort then name so seeded defaults keep their order and
        // custom Areas append after — the shared ordering the in-memory store
        // mirrors in `bySortThenName`.
        .orderBy(asc(generalActionAreas.sortOrder), asc(generalActionAreas.name));

      return rows.map((row) => generalActionAreaSchema.parse(row));
    },
  };
}
