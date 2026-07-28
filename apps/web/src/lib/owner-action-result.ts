export type OwnerActionResult<TView> = { ok: true; view: TView } | { ok: false; error: string };

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
