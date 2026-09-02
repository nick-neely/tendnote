/**
 * What an approval policy decides *about*: the record or destination the call
 * names, resolved inside the caller's own scope before the turn parks.
 */

/** Identity of the call being judged, handed to a subject resolver. */
export interface ApprovalSubjectContext {
  /** The authenticated owner of this turn, already verified by the policy. */
  readonly ownerUserId: string;
  /** Runtime tool name, as eve reports it. */
  readonly toolName: string;
  /** Id of this exact tool call. */
  readonly callId: string;
}

/**
 * The verdict of an owner-scoped lookup, and the whole of it.
 *
 * A resolver answers one question — did this call's subject resolve inside the
 * caller's own scope? — because that is the only answer the policy can act on:
 * `found: false` becomes the uniform opaque denial, and everything else parks.
 * The words the approver reads are not here. eve renders the frozen tool input,
 * and the web card fetches the record's description from the shared registry
 * (`@tendnote/db/queries/approval-subjects`), so a second rendering on this side
 * would only be a copy nobody displays.
 */
export interface SubjectLookupOutcome {
  readonly found: boolean;
}

export type ApprovalSubjectResolver<TInput> = (
  input: Readonly<TInput> | undefined,
  ctx: ApprovalSubjectContext,
) => SubjectLookupOutcome | Promise<SubjectLookupOutcome>;
