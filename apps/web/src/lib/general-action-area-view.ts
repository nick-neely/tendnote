import type { GeneralActionArea } from "@tendnote/domain";
import type { OwnerActionResult } from "@/lib/owner-action";

/**
 * A serializable Area for client components. Archived Areas are kept in the map the
 * surface uses to resolve names (so an Action filed under a since-archived Area
 * still shows its label), but they never appear in the filter or picker — the
 * `archived` flag lets the surface partition the two uses.
 */
export type GeneralActionAreaView = {
  id: string;
  name: string;
  archived: boolean;
};

/**
 * Result of an Area mutation server action. Validation failures (a duplicate name,
 * an archived Area) return `{ ok: false, error }` with a curated, user-safe message
 * so the manager can show it inline; unexpected/infra failures reject instead, and
 * the client shows a generic fallback. Mirrors `GeneralActionMutationResult`.
 */
export type GeneralActionAreaMutationResult = OwnerActionResult<GeneralActionAreaView>;

export function toGeneralActionAreaView(
  area: Pick<GeneralActionArea, "id" | "name" | "archivedAt">,
): GeneralActionAreaView {
  return {
    id: area.id,
    name: area.name,
    archived: area.archivedAt !== null,
  };
}
