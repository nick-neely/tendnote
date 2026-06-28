import { generateDraft } from "@tendnote/db/queries/drafts";
import { messageDraftChannelSchema, messageDraftPurposeSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe(
      "The resolved Tendnote person to draft a message to. Resolve identity with search_people first; if it is unclear or there are multiple matches, ask the user to disambiguate instead of calling this tool.",
    ),
  purpose: messageDraftPurposeSchema
    .optional()
    .describe(
      "Why the message is being written: birthday, thank_you, check_in, networking, or other. Defaults to other.",
    ),
  channel: messageDraftChannelSchema
    .optional()
    .describe(
      "How the user plans to send it themselves (text, email, slack, other). Defaults to text.",
    ),
  toneInstruction: z
    .string()
    .optional()
    .describe(
      "Optional tone request from the user, e.g. 'warmer', 'shorter', 'more professional'. Pass it through verbatim; do not invent one.",
    ),
  includeRestricted: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the user directly asked to draft about a delicate/restricted topic for this person. Defaults false, keeping restricted context out of the draft.",
    ),
  followupContext: z
    .object({
      id: z.uuid(),
      reason: z.string().min(1),
    })
    .optional()
    .describe("When drafting from a due or suggested follow-up, its id and reason for grounding."),
  briefItemContext: z
    .object({
      id: z.uuid(),
      title: z.string().min(1),
      reason: z.string().min(1).optional(),
    })
    .optional()
    .describe("When drafting from a current brief item, its id, title, and reason for grounding."),
});

/** Reason-specific guidance for a declined draft, so the model clarifies correctly. */
function refusalGuidance(
  reason: "person_not_found" | "insufficient_context" | "generation_failed",
) {
  switch (reason) {
    case "person_not_found":
      return "The person couldn't be resolved. Confirm who the message is for with search_people before drafting.";
    case "insufficient_context":
      return "There isn't enough grounded context to draft a good message. Tell the user and offer to capture a note or ask a clarifying question — do not invent details.";
    case "generation_failed":
      return "Drafting is temporarily unavailable (the draft generator failed). Tell the user it didn't go through and offer to try again — do not write the message yourself.";
  }
}

/**
 * Eve-facing draft tool (PRD #75, issue #80). It calls the one shared owner-scoped
 * draft generator the web surfaces use, so drafting policy — trust tiers,
 * restricted-content exclusion, source grounding, refusal on thin/ambiguous
 * context — cannot fork. It persists a Tendnote-owned draft record and returns a
 * component that references that persisted draft, never unpersisted model output.
 *
 * Phase 1G boundary: this NEVER sends a message, creates a Gmail/external draft,
 * or calls a provider. It only prepares a private Tendnote draft for the user to
 * review, edit, copy, and send themselves.
 */
export default defineTool({
  description:
    "Prepare a private Tendnote message draft for a person and persist it for the user to review. This creates a Tendnote-only draft record — it NEVER sends a message, creates a Gmail or external draft, or contacts anyone. Requires a resolved personId (use search_people first); if identity is unclear or there are multiple matches, ask the user to disambiguate instead of drafting. The draft is grounded in the person's trust-aware context: approved memories as confirmed facts, source records as logged context, suggested memories only as tentative hints — it never invents personal facts. If there isn't enough grounded context (or the person can't be resolved), it declines instead of writing a hollow message; tell the user and offer to capture a note or ask a question. The result references the persisted draft by id (for your tool calls only) and includes the body and a grounding summary — refer to the person by name and never show a raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await generateDraft({
      ownerUserId,
      personId: input.personId,
      purpose: input.purpose,
      channel: input.channel,
      toneInstruction: input.toneInstruction,
      directlyRequested: input.includeRestricted ?? false,
      followupContext: input.followupContext,
      briefItemContext: input.briefItemContext,
    });

    if (outcome.status === "skipped") {
      // Refuse over inventing: surface why so the model can clarify or capture a
      // note rather than guess (PRD user stories #30/#31/#40). Each reason gets
      // its own guidance so an adapter failure is never mistaken for thin context.
      return {
        created: false as const,
        reason: outcome.reason,
        guidance: refusalGuidance(outcome.reason),
      };
    }

    const draft = outcome.draft;

    return {
      created: true as const,
      // Refresh-stable reference to the persisted draft (ADR-0028): the draft is
      // persisted before this returns, and the web chat keys its card off this id
      // so a refresh reloads the authoritative record rather than chat text.
      component: {
        type: "message_draft",
        draftId: draft.id,
      },
      draft: {
        id: draft.id,
        personId: draft.personId,
        channel: draft.channel,
        purpose: draft.purpose,
        status: draft.status,
        body: draft.body,
      },
      // Grounding the draft used, by trust tier — labels only, never raw ids.
      grounding: draft.sourceRefs.map((ref) => ({
        trust: ref.trust,
        label: ref.label,
      })),
      guidance:
        "This is a private Tendnote-only draft, shown to the user in a draft card with the full body, its grounding, and Copy/Edit controls. Do not reprint the body or restate the grounding in your reply — point to the card below and offer to adjust the tone or wording. Never claim it was sent or that an external/Gmail draft was created. Refer to the person by name, never by id.",
    };
  },
  // The chat renders a created draft as a card showing the full message, its
  // grounding, and Copy/Edit controls — the user already sees all of it. Project
  // the model's view down to the gist (Eve `toModelOutput`) so it can't reprint
  // what the card shows; the channel still receives the full output above for
  // rendering (see search_relationship_context for the same pattern).
  toModelOutput(output) {
    if (!output.created) {
      // Declined: the model still needs the reason + guidance to clarify or
      // capture a note rather than invent a message.
      return {
        type: "json",
        value: { created: false, reason: output.reason, guidance: output.guidance },
      };
    }
    return {
      type: "json",
      value: {
        created: true,
        rendered:
          "The draft is shown to the user in a card with the full message, its grounding, and Copy/Edit controls.",
        guidance:
          "Do not repeat the message body or restate its grounding — both are already in the card the user sees. Reply with one short line that points to the draft below and offers to adjust the tone or wording. Never claim it was sent or that an external/Gmail draft was created; refer to the person by name.",
      },
    };
  },
});
