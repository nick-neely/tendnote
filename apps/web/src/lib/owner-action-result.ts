import type { SavedItemConflictView } from "@/lib/saved-item-conflict";

/**
 * What the writer needs to resolve a lost race without losing their draft.
 *
 * The rule is "preserve what they typed, show what is there now, make them
 * choose" — so the current value, who wrote it, and the revision a deliberate
 * replace would carry all travel back with the failure. Re-reading afterwards
 * would just be a second race.
 */
export type OwnerActionConflict = {
  currentValue: string | null;
  actorLabel: string | null;
  revision: number;
};

export type OwnerActionResult<TView> =
  | { ok: true; view: TView }
  | {
      ok: false;
      error: string;
      focusContextFactId?: string;
      conflict?: OwnerActionConflict;
      /**
       * The authoritative current value behind a household-native optimistic
       * concurrency refusal, so the form can put it beside the kept draft
       * instead of only saying the write did not land (ADR 0209).
       */
      savedItemConflict?: SavedItemConflictView;
      /**
       * True when the refusal is only that the destination does not exist yet.
       * Nothing went wrong and there is nothing to correct, so a surface reading
       * this must render the message as a quiet note rather than an error - no
       * destructive color and no assertive live region (DESIGN.md §2, §8).
       */
      unavailableDestination?: true;
    };

/** A curated owner-facing failure returned as data by the Server Action protocol. */
export class OwnerActionFailure extends Error {
  override readonly name = "OwnerActionFailure";
}

/** Consume the one action result union at a UI boundary. Infrastructure errors remain distinct. */
export function unwrapOwnerActionResult<TView>(result: OwnerActionResult<TView>): TView {
  if (!result.ok) throw new OwnerActionFailure(result.error);
  return result.view;
}

/** Only protocol-curated failures may be rendered verbatim to an owner. */
export function ownerActionFailureMessage(error: unknown): string | null {
  return error instanceof OwnerActionFailure ? error.message : null;
}
