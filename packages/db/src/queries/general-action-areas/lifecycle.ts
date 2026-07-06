import {
  assertAreaNotArchived,
  DEFAULT_GENERAL_ACTION_AREA_NAMES,
  type GeneralActionArea,
  GeneralActionValidationError,
  generalActionAreaNameSchema,
  normalizeAreaName,
} from "@tendnote/domain";
import type {
  CreateGeneralActionAreaManagerInput,
  GeneralActionAreaActionInput,
  GeneralActionAreaStore,
  ListGeneralActionAreasInput,
  RenameGeneralActionAreaInput,
} from "./types";

/**
 * Detects the Postgres unique-violation (SQLSTATE 23505) raised by the partial
 * `(owner_user_id, lower(name)) where archived_at is null` index. The driver may
 * surface the code on the error or on its `cause`, so both are checked. The only
 * unique index on the table is the Area-name one, so 23505 always means a name
 * collision.
 */
function isUniqueNameViolation(error: unknown): boolean {
  const code =
    (error as { code?: unknown })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code;
  return code === "23505";
}

/**
 * Shared owner-scoped Area management: the single source of truth for seeding the
 * default Areas, creating, renaming, archiving, and restoring flat custom Areas
 * (ADR 0146, #179). The web surface (and, later, Eve) are thin callers over these
 * functions so owner scoping, name uniqueness, and archive rules never fork between
 * surfaces. Areas stay flat here — there is no nesting, no tag join, and no parent
 * column to manage.
 */
export function createGeneralActionAreaManager(store: GeneralActionAreaStore) {
  /** Loads an owner-scoped Area or throws so callers cannot touch another owner's. */
  async function requireArea(input: GeneralActionAreaActionInput): Promise<GeneralActionArea> {
    const area = await store.getArea(input);

    if (!area) {
      throw new Error("Area not found.");
    }

    return area;
  }

  /**
   * Rejects a name that collides (case-insensitively) with an existing *active*
   * Area, so flat Areas stay distinct per owner. Archived names are free to reuse.
   * This is the friendly common-case guard; the partial unique index is the
   * race-proof backstop (see `withFriendlyNameCollision`).
   */
  async function assertNameAvailable(
    ownerUserId: string,
    name: string,
    excludeAreaId?: string,
  ): Promise<void> {
    const normalized = normalizeAreaName(name);
    const active = await store.listAreasForOwner({ ownerUserId });
    const clash = active.some(
      (area) => area.id !== excludeAreaId && normalizeAreaName(area.name) === normalized,
    );

    if (clash) {
      throw new GeneralActionValidationError("You already have an area with that name.");
    }
  }

  /**
   * Translates the partial-unique-index violation into the same friendly
   * name-collision error, so a mutation that loses the race with the list-then-check
   * guard still fails cleanly rather than surfacing a raw DB error.
   */
  async function withFriendlyNameCollision<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueNameViolation(error)) {
        throw new GeneralActionValidationError("You already have an area with that name.");
      }
      throw error;
    }
  }

  /** The next sort position, after every Area the owner has (archived included). */
  async function nextSortOrder(ownerUserId: string): Promise<number> {
    const all = await store.listAreasForOwner({ ownerUserId, includeArchived: true });
    return all.reduce((max, area) => Math.max(max, area.sortOrder), -1) + 1;
  }

  return {
    /**
     * Seeds the owner's default Areas the first time they open Actions, and is a
     * no-op afterward. "First time" means the owner has no Areas at all (archived
     * included), so someone who has archived every default is not re-seeded. Returns
     * the owner's active Areas either way.
     */
    async ensureDefaultAreas({ ownerUserId }: { ownerUserId: string }) {
      const existing = await store.listAreasForOwner({ ownerUserId, includeArchived: true });

      if (existing.length === 0) {
        // One atomic, on-conflict-do-nothing insert: no partial-seed on failure, and
        // a concurrent first-load can't double-seed (the unique index absorbs it).
        await store.createAreas({
          areas: DEFAULT_GENERAL_ACTION_AREA_NAMES.map((name, index) => ({
            ownerUserId,
            name,
            sortOrder: index,
            archivedAt: null,
          })),
        });
      }

      return store.listAreasForOwner({ ownerUserId });
    },

    /** The owner's Areas for the filter and picker; archived excluded by default. */
    listAreas(input: ListGeneralActionAreasInput) {
      return store.listAreasForOwner(input);
    },

    /** Creates a flat custom Area, appended after the owner's existing Areas. */
    async createArea({ ownerUserId, name }: CreateGeneralActionAreaManagerInput) {
      const parsedName = generalActionAreaNameSchema.parse(name);
      await assertNameAvailable(ownerUserId, parsedName);
      const sortOrder = await nextSortOrder(ownerUserId);

      return withFriendlyNameCollision(() =>
        store.createArea({ ownerUserId, name: parsedName, sortOrder, archivedAt: null }),
      );
    },

    /** Renames an active Area, keeping names distinct per owner. */
    async renameArea({ ownerUserId, areaId, name }: RenameGeneralActionAreaInput) {
      const area = await requireArea({ ownerUserId, areaId });
      assertAreaNotArchived(area);
      const parsedName = generalActionAreaNameSchema.parse(name);
      await assertNameAvailable(ownerUserId, parsedName, areaId);

      return withFriendlyNameCollision(() =>
        store.updateArea({ ownerUserId, areaId, patch: { name: parsedName } }),
      );
    },

    /**
     * Archives an Area so it drops out of the filter and picker while any Actions
     * already filed under it keep it (archive is not delete; ADR 0146). Archiving an
     * already-archived Area is rejected.
     */
    async archiveArea({ ownerUserId, areaId }: GeneralActionAreaActionInput) {
      const area = await requireArea({ ownerUserId, areaId });
      assertAreaNotArchived(area);

      return store.updateArea({ ownerUserId, areaId, patch: { archivedAt: new Date() } });
    },

    /**
     * Restores an archived Area so it returns to the filter and picker — the
     * recovery path that makes archive genuinely non-destructive. Rejects if the
     * Area isn't archived, or (friendly) if an active Area now holds the name, since
     * reactivating it would collide on the partial unique index.
     */
    async unarchiveArea({ ownerUserId, areaId }: GeneralActionAreaActionInput) {
      const area = await requireArea({ ownerUserId, areaId });
      if (!area.archivedAt) {
        throw new GeneralActionValidationError("That area isn't archived.");
      }
      await assertNameAvailable(ownerUserId, area.name, areaId);

      return withFriendlyNameCollision(() =>
        store.updateArea({ ownerUserId, areaId, patch: { archivedAt: null } }),
      );
    },

    getArea(input: GeneralActionAreaActionInput) {
      return requireArea(input);
    },
  };
}
