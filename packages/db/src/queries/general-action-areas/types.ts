import type {
  CreateGeneralActionAreaInput,
  GeneralActionArea,
  GeneralActionAreaUpdate,
} from "@tendnote/domain";

/**
 * Owner-scoped CRUD for flat General Action Areas. Every method is keyed on
 * `ownerUserId` so a caller can only ever read or mutate their own Areas (AGENTS.md
 * owner-scoped seams). Areas are flat by construction — there is no parent lookup or
 * tree traversal here, only a list per owner (ADR 0146).
 */
export type GeneralActionAreaStore = {
  createArea: (input: CreateGeneralActionAreaInput) => Promise<GeneralActionArea>;
  /**
   * Inserts many Areas in one atomic statement, skipping any that would collide with
   * an existing active name (on-conflict-do-nothing against the partial unique
   * index). Used for default seeding so a partial failure can't leave a half-seeded
   * set and concurrent first-loads can't double-seed. Returns the rows created.
   */
  createAreas: (input: { areas: CreateGeneralActionAreaInput[] }) => Promise<GeneralActionArea[]>;
  getArea: (input: { ownerUserId: string; areaId: string }) => Promise<GeneralActionArea | null>;
  updateArea: (input: {
    ownerUserId: string;
    areaId: string;
    patch: GeneralActionAreaUpdate;
  }) => Promise<GeneralActionArea>;
  /**
   * Lists the owner's Areas ordered by `sortOrder` ascending, then name, so the
   * seeded defaults keep their curated order and custom Areas follow. Archived Areas
   * are excluded unless `includeArchived` is set. Both store implementations MUST
   * honor this ordering so the filter and picker behave identically.
   */
  listAreasForOwner: (input: {
    ownerUserId: string;
    includeArchived?: boolean;
  }) => Promise<GeneralActionArea[]>;
};

export type GeneralActionAreaActionInput = { ownerUserId: string; areaId: string };

export type ListGeneralActionAreasInput = {
  ownerUserId: string;
  includeArchived?: boolean;
};

export type CreateGeneralActionAreaManagerInput = {
  ownerUserId: string;
  name: string;
};

export type RenameGeneralActionAreaInput = GeneralActionAreaActionInput & {
  name: string;
};
