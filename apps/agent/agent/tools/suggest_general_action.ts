import { suggestGeneralAction } from "@tendnote/db/queries/general-actions";
import {
  generalActionLinkSchema,
  generalActionRecurrenceSchema,
  RESTRICTED_REVEAL_REQUEST_DESCRIPTION,
} from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireRestrictedRevealApproval } from "../lib/approval";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("The proposed action, in plain language (e.g. 'Book the campsite for the trip')."),
  notes: z.string().optional().describe("Optional extra detail for the proposal."),
  dueAt: z
    .string()
    .optional()
    .describe(
      "Optional concrete proposed due date as an ISO 8601 string. Resolve relative phrases first; omit for an unscheduled proposal.",
    ),
  recurrence: generalActionRecurrenceSchema
    .nullish()
    .describe(
      "Optional simple cadence (e.g. {interval: 3, unit: 'month'}). Its presence proposes a Routine. Simple cadence only.",
    ),
  areaId: z
    .uuid()
    .optional()
    .describe(
      "Optional Area to file the proposed action under, taken from list_general_action_areas — never an invented id. Omit to leave it unfiled.",
    ),
  personIds: z
    .array(z.uuid())
    .optional()
    .describe(
      "Optional people the proposal is about — context links, resolved with search_people.",
    ),
  links: z
    .array(generalActionLinkSchema)
    .optional()
    .describe("Optional reference links (a URL with an optional label)."),
  sourceRecordId: z
    .uuid()
    .describe(
      "The source record this proposal is grounded in — the note you just logged, the record under review, or one returned by search. A suggestion must be grounded.",
    ),
  directlyRequested: z
    .boolean()
    .optional()
    .describe(
      "Ask to ground this on a restricted-sensitivity source record, which proactive " +
        `suggestion excludes by default. ${RESTRICTED_REVEAL_REQUEST_DESCRIPTION}`,
    ),
});

type SuggestGeneralActionInput = z.infer<typeof inputSchema>;

/**
 * Thin wrapper over the shared review-gated suggestion path (ADRs 0144, 0151, 0159).
 * Eve proposes a SUGGESTED General Action — never an active one — only in an explicit
 * flow: after logging a note, while reviewing a source record, or when the user asks
 * for a suggestion. The proposal persists as `suggested`, grounded in a source record,
 * and never surfaces on the active ledger until the user accepts it. Restricted
 * context is excluded unless the user directly asked. This never creates an active
 * action (use `create_general_action` for that, only on an explicit ask).
 */
export default defineTool({
  // Restricted grounding is a reveal even inside a review card, so the flag asks
  // the owner instead of asserting they already asked. An ordinary suggestion
  // (the flag unset) is untouched for every caller (ADR 0058).
  approval: requireRestrictedRevealApproval<SuggestGeneralActionInput>(),
  description:
    "Propose a SUGGESTED General Action for the user to review — never an active one. Use this only in an explicit flow: just logged a note, reviewing a source record, or the user asked 'what should I do about X?' / 'suggest an action'. Requires the sourceRecordId it is grounded in. Do NOT scan the user's data and invent actions, and do NOT create active actions this way — the result is tentative until the user accepts it. To break a request into a few proposed steps at once, use plan_suggested_general_actions. Returns the persisted suggestion reference and a review component; refer to it by title, never the raw id. Setting directlyRequested pauses the call for the user to approve restricted grounding; if they decline, do not propose it another way.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      suggestGeneralAction({
        ownerUserId,
        title: input.title,
        notes: input.notes ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        recurrence: input.recurrence ?? null,
        areaId: input.areaId ?? null,
        personIds: input.personIds,
        links: input.links,
        sourceRecordId: input.sourceRecordId,
        directlyRequested: input.directlyRequested,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      found: true as const,
      component: result.component,
      action: toGeneralActionRef(result.action),
      sourceRecord: result.sourceRecord ? { id: result.sourceRecord.id } : null,
    };
  },
  // Drop the id from the model's view (it never surfaces ids); keep the title/status so
  // the user can ask you to accept or dismiss it. The chat renders an interactive review
  // card with Accept/Dismiss buttons, so the model offers it briefly and defers detail.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        proposed: true,
        action: toGeneralActionModelRef(output.action),
        rendered: "The suggestion is shown to the user in a review card.",
        guidance:
          "It's a TENTATIVE suggestion shown as a review card the user can accept or dismiss. Offer it in one sentence; don't restate its details. It's not an active action until they accept it.",
      },
    };
  },
});
