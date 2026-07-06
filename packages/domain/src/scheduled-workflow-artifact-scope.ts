import type { PrivacyScope } from "./privacy";

/**
 * A single unit of content aggregated into a scheduled-workflow artifact, reduced
 * to just the disclosure facts the artifact's scope depends on. An omitted `scope`
 * means the producing query never plumbed a scope for this item, which is treated
 * as unknown and fails closed to `private` (see `aggregateArtifactScope`).
 */
export type ArtifactScopeItem = {
  scope?: PrivacyScope;
  householdId?: string | null;
};

export type AggregatedArtifactScope = {
  scope: PrivacyScope;
  householdId: string | null;
};

/**
 * Normalize a backing record's raw scope into the fail-closed shape snapshotted
 * onto an artifact item: an omitted scope becomes `private`, and a `householdId`
 * is only ever retained for a `household` scope (a stray household id on a
 * private/shared item is dropped so it can never leak into aggregation). Shared by
 * the brief generator and the birthday builder so the normalization can't diverge.
 */
export function normalizeItemScope(item: ArtifactScopeItem): AggregatedArtifactScope {
  const scope = item.scope ?? "private";
  return { scope, householdId: scope === "household" ? (item.householdId ?? null) : null };
}

/**
 * Derive the aggregate disclosure scope of a scheduled-workflow artifact from the
 * scopes of the items it is built from. This is the fail-closed policy seam that
 * feeds `ScheduledWorkflowDeliveryArtifact.scope`/`householdId`; the delivery
 * matrix (ADR-0141) then gates that scope against the target's policy and is never
 * weakened here.
 *
 * The rule (ADR-0142): an artifact is only as shareable as its least-shareable
 * item. It carries `household` scope for household H **only** when it is built
 * exclusively from `household`-visible items that all belong to the same household
 * H. Anything less certain — an empty artifact, any item of unknown scope, any
 * `private` item, any `shared` (selected-members) item, a household item with no
 * household id, or household items spanning two different households — collapses to
 * `private`, so a mixed or uncertain artifact is never broadcast to a shared
 * channel.
 */
export function aggregateArtifactScope(
  items: ReadonlyArray<ArtifactScopeItem>,
): AggregatedArtifactScope {
  const privateResult: AggregatedArtifactScope = { scope: "private", householdId: null };

  // An empty artifact has no household to key on, so it can only be private.
  if (items.length === 0) {
    return privateResult;
  }

  let householdId: string | null = null;

  for (const item of items) {
    // Unknown, private, or shared content all fail closed: only whole-household
    // content can ever widen an artifact beyond the owner.
    if (item.scope !== "household") {
      return privateResult;
    }
    if (!item.householdId) {
      return privateResult;
    }
    if (householdId === null) {
      householdId = item.householdId;
    } else if (householdId !== item.householdId) {
      // Two households in one artifact: there is no single safe household target.
      return privateResult;
    }
  }

  return { scope: "household", householdId };
}
