/**
 * Stable data scopes emitted by owner-scoped mutations.
 *
 * The union names data, never framework cache tags or routes. Collection scopes
 * identify either an owner's private projection or a viewer's visibility-filtered
 * projection. Entity scopes identify the viewer-specific record projection.
 * Framework adapters translate these scopes into their own reconciliation effects.
 */
export type AffectedScope =
  | {
      kind: "owner-collection";
      collection: "review" | "today";
      ownerUserId: string;
    }
  | {
      kind: "viewer-collection";
      collection: "general-actions";
      viewerUserId: string;
    }
  | {
      kind: "viewer-entity";
      entity: "general-action";
      entityId: string;
      viewerUserId: string;
    };

/** A committed domain result paired with the stable scopes changed by the write. */
export type MutationOutcome<TResult> = {
  result: TResult;
  affectedScopes: AffectedScope[];
};
