import { z } from "zod";

/**
 * A link between a General Action and an Asset (#199): the durable bridge the
 * Phase 5 asset-hint stub was designed to grow into (ADR 0156). A link is
 * context, not ownership — it never changes either record's visibility, and each
 * side is scope-filtered independently when the other is displayed. `hintLabel`
 * preserves which hint the link came from, so promotion stays idempotent per
 * hint and surfaces can pair a hint chip with the Asset it became.
 */
export const generalActionAssetLinkSchema = z.object({
  id: z.string(),
  // The action owner who created the link. The linked asset may belong to a
  // co-member after duplicate review links to an existing household Asset.
  ownerUserId: z.string(),
  generalActionId: z.string(),
  assetId: z.string(),
  hintLabel: z.string().trim().min(1).max(120).nullable().default(null),
  createdAt: z.date(),
});

export const createGeneralActionAssetLinkSchema = generalActionAssetLinkSchema.omit({
  id: true,
  createdAt: true,
});

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
