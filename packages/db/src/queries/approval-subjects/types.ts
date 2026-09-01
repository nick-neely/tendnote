/**
 * What an owner is actually being asked about when Eve parks a tool call.
 *
 * eve freezes the tool input onto its approval request and renders nothing else,
 * so an id-referenced write ("archive memory 3f2a…") reaches the approval card as
 * a UUID. That is not a decision anybody can make. These types carry the record
 * itself - resolved inside the caller's own scope - in the one shape both the
 * agent policy and the web card read.
 */

/** One record or destination, rendered for a person. Plain text; no markdown. */
export type ApprovalSubject = {
  /** One imperative line naming the action: "Archive a memory about Ana". */
  readonly title: string;
  /** Detail lines in the order they should be read. Never empty strings. */
  readonly lines: readonly string[];
};

/**
 * The three answers a lookup can give, and what each obliges the caller to do.
 *
 * `missing` covers "no such record", "not this owner's", and "the input did not
 * parse" without distinguishing them: the caller turns all three into the one
 * opaque denial (ADR 0219), so a foreign id never reaches an approval card and
 * the card is never an existence oracle.
 */
export type ApprovalSubjectLookup =
  | { readonly kind: "described"; readonly subject: ApprovalSubject }
  | { readonly kind: "missing" }
  | { readonly kind: "unknown-tool" };
