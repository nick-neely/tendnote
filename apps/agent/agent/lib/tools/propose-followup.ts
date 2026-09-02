import { suggestFollowup } from "@tendnote/db/queries/followups";
import { RESTRICTED_REVEAL_REQUEST_DESCRIPTION } from "@tendnote/domain";
import { z } from "zod";
import { requireRestrictedRevealApproval } from "../approval";
import { type OwnerScopedContext, resolveOwnerUserId } from "../owner";
import { requestBackgroundAffectedScopeReconciliation } from "../request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../store-errors";

/**
 * How one registration of the suggestion path introduces itself.
 *
 * The two hand-copied files did not differ in what they did - both call the same
 * review-gated shared path - but the subagent's description had dropped *both* "Do
 * NOT" clauses, including the one that forbids scanning everyone and inventing
 * follow-ups, which is the single rule that keeps Tendnote from behaving like a
 * sales CRM (PRD #42, ADR-0006). Those clauses are no longer a caller's to omit:
 * only the trigger and the grounding hint vary, and both of those describe where a
 * legitimate call comes *from*.
 */
export type ProposeFollowupToolOptions = {
  /** The one flow in which this caller may propose: the sentence after the lead. */
  whenToUse: string;
  /** Where this caller's `sourceRecordId` legitimately comes from. */
  groundingHint: string;
  /**
   * Whether this registration may ground a suggestion in a restricted source
   * record at all.
   *
   * `"owner-approval"` keeps `directlyRequested` on the model-facing schema and
   * makes it a request: setting it parks the call until the owner answers. A
   * suggestion is review-gated, but the restricted text still travels into a card
   * the owner will read, so the flag widens authority rather than labelling
   * provenance. `"unavailable"` removes the field and pins the proposal to
   * ordinary grounding, which is the only honest answer on a subagent turn -
   * nobody is there to ask (ADR 0058).
   */
  restrictedContext: "owner-approval" | "unavailable";
};

function baseSchemaFor(options: ProposeFollowupToolOptions) {
  return z.object({
    personId: z
      .uuid()
      .describe(
        "The resolved person the suggestion is for. Resolve identity with search_people first.",
      ),
    reason: z
      .string()
      .min(1)
      .describe("Why following up might help, in plain language (e.g. 'check in about the move')."),
    dueAt: z
      .string()
      .describe(
        "A concrete proposed due date as an ISO 8601 string. Resolve relative phrases to a concrete date; if timing is ambiguous, ask instead of calling this tool.",
      ),
    sourceRecordId: z
      .uuid()
      .describe(
        `The source record this suggestion is grounded in - ${options.groundingHint} A suggestion must be grounded.`,
      ),
  });
}

function restrictedSchemaFor(options: ProposeFollowupToolOptions) {
  return baseSchemaFor(options).extend({
    directlyRequested: z
      .boolean()
      .optional()
      .describe(
        "Ask to ground this suggestion in a restricted-sensitivity source record, which " +
          `proactive suggestion excludes by default. ${RESTRICTED_REVEAL_REQUEST_DESCRIPTION}`,
      ),
  });
}

/**
 * The restricted-grounding request, present only where somebody can answer it.
 *
 * One declared shape, two at runtime: the base schema parses to the same object
 * minus one optional field, so declaring the wider type keeps eve's inference on a
 * single object instead of a union it cannot resolve - while the schema eve
 * actually renders for the model is whichever one is returned.
 */
function inputSchemaFor(
  options: ProposeFollowupToolOptions,
): ReturnType<typeof restrictedSchemaFor> {
  return options.restrictedContext === "unavailable"
    ? (baseSchemaFor(options) as ReturnType<typeof restrictedSchemaFor>)
    : restrictedSchemaFor(options);
}

type ProposeFollowupInput = z.infer<ReturnType<typeof restrictedSchemaFor>>;

/**
 * The shared review-gated suggestion path (PRD #42, ADR-0006). Eve proposes
 * follow-ups only in explicit flows - after logging a note, reviewing a source
 * record or memory, viewing a person, being asked whether to follow up, or working
 * an agenda candidate the user raised - never from a background scan. The suggestion
 * is persisted as `suggested` and stays tentative until the user accepts it; it is
 * grounded in a source record and excludes restricted context unless the user
 * directly asked. This never creates an active reminder (use create_followup for
 * that, only on an explicit ask).
 */
const suggestionWrite = {
  async execute(input: ProposeFollowupInput, ctx: OwnerScopedContext) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      suggestFollowup({
        ownerUserId,
        personId: input.personId,
        reason: input.reason,
        // Parsed here; the shared layer rejects anything that isn't a concrete date.
        dueAt: new Date(input.dueAt),
        sourceRecordId: input.sourceRecordId,
        directlyRequested: input.directlyRequested,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      found: true as const,
      component: result.component,
      person: result.person
        ? { id: result.person.id, displayName: result.person.displayName }
        : null,
      followup: {
        id: result.followup.id,
        personId: result.followup.personId,
        reason: result.followup.reason,
        dueAt: result.followup.dueAt.toISOString(),
        status: result.followup.status,
      },
      sourceRecord: result.sourceRecord ? { id: result.sourceRecord.id } : null,
    };
  },
};

type ProposeFollowupOutput = Awaited<ReturnType<typeof suggestionWrite.execute>>;

export function proposeFollowupTool(options: ProposeFollowupToolOptions) {
  return {
    ...(options.restrictedContext === "owner-approval"
      ? {
          // A restricted source record reaching a review card is still a reveal, so
          // the flag asks the owner rather than speaking for them. An ordinary
          // proposal (the flag unset) runs exactly as it always did.
          approval: requireRestrictedRevealApproval<ProposeFollowupInput>(),
        }
      : {}),
    description:
      "Propose a SUGGESTED follow-up for the user to review - never an active reminder. " +
      `${options.whenToUse} ` +
      "Requires a resolved personId, a reason, a concrete proposed dueAt, and the sourceRecordId it is grounded in. " +
      "Do NOT use this to scan everyone and invent follow-ups, and do NOT rank who to check in with. " +
      "The result is tentative until the user accepts it; render it for review and let the user accept, edit, or dismiss. " +
      "Returns the persisted suggestion reference; name the person, never the raw id.",
    inputSchema: inputSchemaFor(options),
    execute: suggestionWrite.execute,
    // The proposal renders as a review card the user already sees. Drop the reason and
    // due date echo from the model's view (Eve `toModelOutput`) so it offers it briefly
    // instead of restating it; keep the id + person so the user can ask you to set or
    // dismiss it. Channel still gets the full output above for rendering.
    toModelOutput(output: ProposeFollowupOutput) {
      return {
        type: "json" as const,
        value: {
          proposed: true,
          followupId: output.followup.id,
          personId: output.followup.personId,
          person: output.person?.displayName ?? null,
          status: output.followup.status,
          rendered:
            "The suggested follow-up is shown to the user in a review card they can accept, edit, or dismiss.",
          guidance:
            "It's a TENTATIVE suggestion, not an active reminder. Do not claim it was accepted or " +
            "set; the user must accept it themselves. Don't reprint the reason or due date - the " +
            "card shows them. Offer it for review in a brief line; set it as a reminder only on " +
            "the user's explicit say-so.",
        },
      };
    },
  };
}
