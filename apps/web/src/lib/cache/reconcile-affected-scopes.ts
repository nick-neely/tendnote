import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { tagsForAffectedScopes } from "./affected-scope-tags";

export type ReconciliationOrigin = "background" | "owner-action";

/**
 * Translates framework-neutral mutation scopes into Next.js cache effects.
 *
 * Direct owner actions synchronously expire tags for read-your-writes. Background
 * writers preserve truthful stale content while the same scopes refresh.
 */
export function reconcileAffectedScopes(
  scopes: readonly AffectedScope[],
  input: { origin: ReconciliationOrigin },
) {
  for (const tag of tagsForAffectedScopes(scopes)) {
    if (input.origin === "owner-action") updateTag(tag);
    else revalidateTag(tag, "max");
  }

  if (scopes.some((scope) => scope.kind === "owner-collection" && scope.collection === "account")) {
    // Account settings and connection pages contain request-time provider state
    // that is intentionally not cached. Tags expire their cached dependants, while
    // these path refreshes update the genuinely untaggable route-owned projections.
    revalidatePath("/account");
    revalidatePath("/account/contacts/import");
    revalidatePath("/account/discord");
  }

  if (
    scopes.some(
      (scope) => scope.kind === "owner-collection" && scope.collection === "context-facts",
    )
  ) {
    revalidatePath("/account/about-you");
  }
}
