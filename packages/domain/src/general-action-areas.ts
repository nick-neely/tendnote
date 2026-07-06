import { z } from "zod";
import { GeneralActionValidationError } from "./general-actions";

/**
 * The Areas every owner is seeded with on first use: flat, broad life categories
 * for organizing General Actions (ADR 0146). They are ordinary Areas once seeded —
 * the owner can rename or archive any of them. An Area is not a project, tag,
 * folder tree, permission scope, or household workspace; Phase 5 stays flat, with
 * no nesting or taxonomy management.
 */
export const DEFAULT_GENERAL_ACTION_AREA_NAMES = [
  "Home",
  "Health",
  "Finance",
  "Travel",
  "Admin",
  "Career",
] as const;

const areaNameSchema = z
  .string()
  .trim()
  .min(1, "Name the area.")
  .max(60, "Keep the area name under 60 characters.");

export const generalActionAreaSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: areaNameSchema,
  // Preserves the curated default order and appends custom Areas after it, so the
  // filter and picker list Areas in a stable, calm order rather than reshuffling.
  sortOrder: z.number().int(),
  // Archived Areas drop out of the filter and picker but are never deleted, so any
  // Action already filed under one keeps its Area (archive is not delete; flat and
  // additive, ADR 0146).
  archivedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createGeneralActionAreaSchema = generalActionAreaSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * A bounded, defaults-free update patch for a persisted Area — same discipline as
 * `generalActionUpdateSchema`. An absent key stays absent instead of being filled
 * with a default, so a rename never accidentally clears `archivedAt` (and vice
 * versa). A store that sets only the returned keys must use this, not a partial of
 * the base schema.
 */
export const generalActionAreaUpdateSchema = z
  .object({
    name: areaNameSchema,
    sortOrder: z.number().int(),
    archivedAt: z.date().nullable(),
  })
  .partial();

export type GeneralActionArea = z.infer<typeof generalActionAreaSchema>;
export type CreateGeneralActionAreaInput = z.input<typeof createGeneralActionAreaSchema>;
export type GeneralActionAreaUpdate = z.infer<typeof generalActionAreaUpdateSchema>;

/** The Area-name input schema, exported so surfaces can validate before submit. */
export { areaNameSchema as generalActionAreaNameSchema };

/**
 * Normalizes an Area name for duplicate detection: trimmed and case-folded, so
 * "Home", "home", and " Home " all collide. Flat Areas must have distinct *active*
 * names per owner (ADR 0146). This is the comparison key only — the entered casing
 * is what gets stored and shown.
 */
export function normalizeAreaName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Guards that an Area is still active. An archived Area cannot be renamed, archived
 * again, or newly assigned to an Action — it has been quietly retired, though the
 * Actions already filed under it keep it (ADR 0146).
 */
export function assertAreaNotArchived(area: Pick<GeneralActionArea, "archivedAt">): void {
  if (area.archivedAt) {
    throw new GeneralActionValidationError("That area is archived.");
  }
}
