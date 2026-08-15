import { randomUUID } from "node:crypto";
import { listPersonEmailContactMethods } from "@tendnote/db/queries/contact-methods";
import { getDraft } from "@tendnote/db/queries/drafts";
import {
  createDefaultGmailApprovalGate,
  createDefaultGoogleGmailDraftService,
  type GmailDraftActionOutcome,
  listGmailDraftActionsForDraft,
} from "@tendnote/db/queries/gmail-drafts";
import { findLinkedGmailDraftAction, gmailDraftApprovalSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  draftId: z
    .uuid()
    .describe(
      "The existing, APPROVED Tendnote message draft to externalize. This tool never drafts from raw relationship context — create a Tendnote draft with create_message_draft first and have the user approve it. If no such draft exists, do not call this tool.",
    ),
  recipientEmail: z
    .string()
    .min(3)
    .describe(
      "The email address the user explicitly confirmed as the recipient. Never guess an address — ask the user for it (or offer a saved one) and pass exactly what they confirmed.",
    ),
  subject: z
    .string()
    .min(1)
    .describe("The subject the user approved for the Gmail draft. Ask the user to confirm it."),
});

/**
 * Eve-facing Gmail draft tool (Phase 2D, ADR-0092). It creates or updates a Gmail
 * DRAFT from an already approved, source-grounded Tendnote draft, going through the
 * SAME shared owner-scoped Gmail draft service and the SAME connection+approval gate
 * the web UI uses — so chat cannot fork external-write policy, bypass approval, or
 * write from raw natural language. It requires an existing approved Tendnote draft
 * (never raw relationship context) and an explicitly confirmed recipient + subject.
 *
 * It NEVER sends email: the adapter behind it exposes only draft create/update
 * (ADR-0089). The result never claims a message was sent and never exposes raw
 * provider payloads — it only reports Tendnote's last known external draft state.
 */
export default defineTool({
  description:
    "Save an APPROVED Tendnote message draft to the user's Gmail as a DRAFT (create it, or update the existing linked Gmail draft after a revision). It NEVER sends email and never contacts anyone — the user sends it themselves from Gmail. Requires an existing approved Tendnote draft (use create_message_draft, then have the user approve it) plus a recipient email and subject the user explicitly confirmed — never draft from raw relationship context, and never infer a recipient. It goes through the same approval gate as the web UI: it is blocked unless Gmail is connected and the Tendnote draft is approved. On success, tell the user their Gmail draft is ready to review and send from Gmail — never say it was sent. On a block or failure, explain why; do not claim anything was saved.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const draft = await withModelSafeStoreErrors(() =>
      getDraft({ ownerUserId, draftId: input.draftId }),
    );
    if (!draft) {
      return {
        written: false as const,
        reason: "draft_not_found" as const,
        guidance:
          "That Tendnote draft doesn't exist. Create one with create_message_draft and have the user approve it before saving to Gmail.",
      };
    }

    // Reuse a saved contact method when the confirmed address matches one; otherwise
    // it is an action-specific manual entry that is never saved as a contact method
    // (ADR-0085). Either way the recipient is validated by the shared approval schema.
    const savedEmails = await withModelSafeStoreErrors(() =>
      listPersonEmailContactMethods({
        ownerUserId,
        personId: draft.personId,
      }),
    );
    const matched = savedEmails.find(
      (method) => method.value.toLowerCase() === input.recipientEmail.trim().toLowerCase(),
    );
    const parsed = gmailDraftApprovalSchema.safeParse({
      subject: input.subject,
      recipient: matched
        ? { email: matched.value, source: "contact_method", contactMethodId: matched.id }
        : { email: input.recipientEmail.trim(), source: "manual_entry", contactMethodId: null },
    });
    if (!parsed.success) {
      return {
        written: false as const,
        reason: "invalid_input" as const,
        guidance:
          "The recipient address or subject wasn't valid. Ask the user to confirm a real email address and a non-empty subject, then try again.",
      };
    }

    const service = createDefaultGoogleGmailDraftService({
      authorize: createDefaultGmailApprovalGate(),
    });

    // An existing Gmail draft means this is an explicit update of the same external
    // draft (targets the stored id, no duplicate); otherwise it is the first create.
    // Uses the ONE shared "linked" predicate so chat and web agree (ADR-0092).
    const existing = await withModelSafeStoreErrors(() =>
      listGmailDraftActionsForDraft({
        ownerUserId,
        messageDraftId: input.draftId,
      }),
    );
    const linked = findLinkedGmailDraftAction(existing);

    const write = {
      ownerUserId,
      messageDraftId: input.draftId,
      subject: parsed.data.subject,
      recipient: parsed.data.recipient,
    };
    // The gate reports its own blocked/failed outcomes as values, so this wrapper
    // only covers a store fault behind them — never the gate's curated copy.
    const outcome: GmailDraftActionOutcome = await withModelSafeStoreErrors(() =>
      linked
        ? service.updateGmailDraft({
            ...write,
            idempotencyKey: `update:${input.draftId}:${randomUUID()}`,
          })
        : service.createGmailDraft({ ...write, idempotencyKey: `create:${input.draftId}` }),
    );

    if (outcome.status === "blocked") {
      // Relay the shared gate's own reason verbatim rather than reinterpreting its
      // wording, so chat guidance can never drift from the gate's copy (ADR-0092).
      return {
        written: false as const,
        reason: "blocked" as const,
        detail: outcome.reason,
        guidance: `${outcome.reason} Tell the user this and what to do about it; do not claim anything was saved to Gmail, and never send.`,
      };
    }

    if (outcome.status === "failed") {
      return {
        written: false as const,
        reason: "failed" as const,
        retryable: true as const,
        guidance:
          "The Gmail draft write failed. Tell the user it didn't go through and that they can retry it from the draft card in the app — do not claim it was saved, and do not retry automatically.",
      };
    }

    return {
      written: true as const,
      action: outcome.action.kind,
      recipientEmail: parsed.data.recipient.email,
      subject: parsed.data.subject,
      guidance:
        "The Gmail draft is ready in the user's Gmail Drafts. Tell them it's saved and ready for them to review and SEND from Gmail themselves — never say it was sent, and never expose ids or provider details. Refer to the person by name.",
    };
  },
  // Project the model's view to the gist: the model never needs the Gmail draft id or
  // any provider detail, and must not claim a send (ADR-0089/0092).
  toModelOutput(output) {
    if (!output.written) {
      return {
        type: "json",
        value: { written: false, reason: output.reason, guidance: output.guidance },
      };
    }
    return {
      type: "json",
      value: {
        written: true,
        action: output.action,
        guidance:
          "Confirm to the user that their Gmail draft is saved and ready to review and send from Gmail themselves. Never say it was sent, never expose ids or provider details, and refer to the person by name.",
      },
    };
  },
});
