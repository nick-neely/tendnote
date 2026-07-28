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
      collection: "assets" | "people" | "review" | "saved-items" | "today";
      ownerUserId: string;
    }
  | {
      kind: "viewer-collection";
      collection: "assets" | "general-actions" | "saved-items";
      viewerUserId: string;
    }
  | {
      kind: "viewer-entity";
      entity: "asset" | "general-action" | "person" | "saved-item";
      entityId: string;
      viewerUserId: string;
    }
  | {
      kind: "visible-entity";
      entity: "asset" | "person" | "saved-item";
      entityId: string;
    }
  | {
      kind: "household-collection";
      collection: "assets" | "saved-items";
      householdId: string;
    }
  | {
      kind: "linked-entity";
      entity: "asset";
      entityId: string;
    };

/** A committed domain result paired with the stable scopes changed by the write. */
export type MutationOutcome<TResult> = {
  result: TResult;
  affectedScopes: AffectedScope[];
};
