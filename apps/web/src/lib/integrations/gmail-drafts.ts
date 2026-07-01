import "server-only";

import { editDraftBody, getDraft } from "@tendnote/db/queries/drafts";
import {
  createDefaultGoogleGmailDraftService,
  type GmailDraftActionOutcome,
} from "@tendnote/db/queries/gmail-drafts";
import { isProviderCapabilityConnected } from "@tendnote/db/queries/provider-connections";
import {
  GMAIL_CAPABILITY_KEY,
  GMAIL_PROVIDER_KEY,
  type GmailDraftRecipient,
  gmailDraftApprovalSchema,
} from "@tendnote/domain";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

/**
 * Hosted product boundary for Gmail draft creation (Phase 2D, ADR-0083). Every path
 * resolves the admitted owner first, then goes through the ONE shared Gmail draft
 * service so web and Eve cannot fork external-write policy. The precondition gate
 * requires a connected `google/gmail` capability and an APPROVED Tendnote draft, so
 * Gmail is only ever written from an approved, source-grounded draft (ADR-0086); the
 * write itself uses the persisted draft body, never modal-only text.
 */

/** Connection + approval gate shared by create and retry (ADR-0083, ADR-0090). */
async function gmailWriteGate(input: {
  ownerUserId: string;
  messageDraftId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const connected = await isProviderCapabilityConnected({
    ownerUserId: input.ownerUserId,
    providerKey: GMAIL_PROVIDER_KEY,
    capabilityKey: GMAIL_CAPABILITY_KEY,
  });
  if (!connected) {
    return { ok: false, reason: "Gmail isn't connected." };
  }
  const draft = await getDraft({ ownerUserId: input.ownerUserId, draftId: input.messageDraftId });
  if (!draft) {
    return { ok: false, reason: "That draft no longer exists." };
  }
  if (draft.status !== "approved") {
    return { ok: false, reason: "Approve the Tendnote draft before saving it to Gmail." };
  }
  return { ok: true };
}

function gmailService() {
  return createDefaultGoogleGmailDraftService({
    authorize: (input) =>
      gmailWriteGate({ ownerUserId: input.ownerUserId, messageDraftId: input.messageDraftId }),
  });
}

export type OwnerGmailDraftResult = {
  outcome: GmailDraftActionOutcome;
  /** The person the draft belongs to, for revalidation (null if the draft is gone). */
  personId: string | null;
};

/**
 * Create a Gmail draft from an approved Tendnote draft. A last-mile body edit is
 * written through the Tendnote draft lifecycle FIRST (ADR-0086), so the external
 * write always uses the persisted draft snapshot, never an unpersisted variation.
 * Idempotent per Tendnote draft: a resubmit returns the existing action instead of
 * creating a duplicate Gmail draft (retries go through `retryOwnerGmailDraft`).
 */
export async function createOwnerGmailDraft(input: {
  draftId: string;
  recipient: GmailDraftRecipient;
  subject: string;
  /** Optional last-mile body edit to persist through the draft before the write. */
  bodyEdit?: string;
}): Promise<OwnerGmailDraftResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const approval = gmailDraftApprovalSchema.parse({
    subject: input.subject,
    recipient: input.recipient,
  });

  const draft = await getDraft({ ownerUserId, draftId: input.draftId });
  const personId = draft?.personId ?? null;

  // Write last-mile body edits through the Tendnote draft lifecycle before Gmail is
  // touched, so Tendnote stays the source of truth (ADR-0086). Only when it changed.
  // This persists even if the Gmail write is later blocked (e.g. duplicate) — the
  // edit is a legitimate change to the user's own draft, independent of the external
  // write, and Gmail itself is never mutated on a blocked outcome.
  if (draft && input.bodyEdit !== undefined) {
    const nextBody = input.bodyEdit.trim();
    if (nextBody && nextBody !== draft.body) {
      await editDraftBody({ ownerUserId, draftId: input.draftId, body: nextBody });
    }
  }

  const outcome = await gmailService().createGmailDraft({
    ownerUserId,
    messageDraftId: input.draftId,
    subject: approval.subject,
    recipient: approval.recipient,
    idempotencyKey: `create:${input.draftId}`,
  });

  return { outcome, personId };
}

/**
 * Explicitly retry a failed Gmail draft action (ADR-0091). Reuses the same durable
 * record; never runs in the background. The gate is re-checked so a since-revoked
 * Gmail connection or un-approved draft blocks the retry.
 */
export async function retryOwnerGmailDraft(input: {
  actionId: string;
  draftId: string;
}): Promise<OwnerGmailDraftResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const draft = await getDraft({ ownerUserId, draftId: input.draftId });
  const outcome = await gmailService().retryGmailDraftAction({
    ownerUserId,
    actionId: input.actionId,
  });
  return { outcome, personId: draft?.personId ?? null };
}
