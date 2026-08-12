import { z } from "zod";

/**
 * A link between a General Action and an Asset (#199): the durable bridge the
 * Phase 5 asset-hint stub was designed to grow into (ADR 0156). A link is
 * context, not ownership — it never changes either record's visibility, and each
 * side is scope-filtered independently when the other is displayed. `hintLabel`
 * preserves which hint the link came from, so promotion stays idempotent per
 * hint and surfaces can pair a hint chip with the Asset it became.
 *
 * The two provenance columns are mutually exclusive in practice and name the two
 * ways a link is born: `hintLabel` for a Phase 5 hint promoted into an Asset
 * (#199), `assetMemoryId` for an action *proposed from* a reviewed Asset Memory
 * (#203). A link with neither is a plain association.
 */
export const generalActionAssetLinkSchema = z.object({
  id: z.string(),
  // Historical attribution only. Authority is proved independently through
  // the Action and Asset parents; deletion of this account leaves the link.
  createdByUserId: z.string().nullable(),
  generalActionId: z.string(),
  assetId: z.string(),
  hintLabel: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * The reviewed Asset Memory this action was proposed from (#203), or null. This
   * is what keeps proposal generation idempotent: one memory proposes one action,
   * and a memory whose proposal was already reviewed is never re-proposed.
   */
  assetMemoryId: z.string().nullable().default(null),
  createdAt: z.date(),
});

export const createGeneralActionAssetLinkSchema = generalActionAssetLinkSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({ createdByUserId: z.string() });

export type GeneralActionAssetLink = z.infer<typeof generalActionAssetLinkSchema>;
export type CreateGeneralActionAssetLinkInput = z.input<typeof createGeneralActionAssetLinkSchema>;

/**
 * Whether two asset-hint labels name the same hint: trimmed, case-insensitive.
 * Deliberately exact beyond casing — "fridge filter" and "refrigerator water
 * filter" are different *hints* even though duplicate review may say they are
 * the same *asset*; alias matching belongs to the duplicate gate, not here.
 */
export function assetHintLabelsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
