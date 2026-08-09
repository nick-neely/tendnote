import type { SavedItemConflictView } from "@/lib/saved-item-conflict";

export type OwnerActionResult<TView> =
  | { ok: true; view: TView }
  | {
      ok: false;
      error: string;
      focusContextFactId?: string;
      /**
       * The authoritative current value behind a household-native optimistic
       * concurrency refusal, so the form can put it beside the kept draft
       * instead of only saying the write did not land (ADR 0209).
       */
      savedItemConflict?: SavedItemConflictView;
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
