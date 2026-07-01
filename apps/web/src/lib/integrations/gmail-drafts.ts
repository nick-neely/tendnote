import "server-only";

import { randomUUID } from "node:crypto";
import { editDraftBody, getDraft } from "@tendnote/db/queries/drafts";
import {
  createDefaultGmailApprovalGate,
  createDefaultGoogleGmailDraftService,
  type GmailDraftActionOutcome,
} from "@tendnote/db/queries/gmail-drafts";
import { type GmailDraftRecipient, gmailDraftApprovalSchema } from "@tendnote/domain";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

/**
 * Hosted product boundary for Gmail draft creation (Phase 2D, ADR-0083). Every path
 * resolves the admitted owner first, then goes through the ONE shared Gmail draft
 * service, composed with the ONE shared approval gate (connected `google/gmail` +
 * approved Tendnote draft), so web and Eve cannot fork external-write policy
 * (ADR-0092). Gmail is only ever written from an approved, source-grounded draft
 * (ADR-0086); the write itself uses the persisted draft body, never modal-only text.
 */
function gmailService() {
  return createDefaultGoogleGmailDraftService({ authorize: createDefaultGmailApprovalGate() });
}

export type OwnerGmailDraftResult = {
  outcome: GmailDraftActionOutcome;
  /** The person the draft belongs to, for revalidation (null if the draft is gone). */
  personId: string | null;
};

export type GmailDraftWriteRequest = {
  draftId: string;
  recipient: GmailDraftRecipient;
  subject: string;
  /** Optional last-mile body edit to persist through the draft before the write. */
  bodyEdit?: string;
};

/**
 * Resolve the admitted owner, validate the approval, and write a last-mile body edit
 * through the Tendnote draft lifecycle BEFORE Gmail is touched (ADR-0086), so both
 * the create and update paths use the persisted draft snapshot rather than an
 * unpersisted variation. The edit persists even if the Gmail write is later blocked
 * — it is a legitimate change to the user's own draft, independent of the external
 * write, and Gmail itself is never mutated on a blocked outcome.
 */
async function prepareApprovedGmailWrite(input: GmailDraftWriteRequest) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const approval = gmailDraftApprovalSchema.parse({
    subject: input.subject,
    recipient: input.recipient,
  });

  const draft = await getDraft({ ownerUserId, draftId: input.draftId });
  const personId = draft?.personId ?? null;

  if (draft && input.bodyEdit !== undefined) {
    const nextBody = input.bodyEdit.trim();
    if (nextBody && nextBody !== draft.body) {
      await editDraftBody({ ownerUserId, draftId: input.draftId, body: nextBody });
    }
  }

  return { ownerUserId, approval, personId };
}

/**
 * Create a Gmail draft from an approved Tendnote draft. Idempotent per Tendnote
 * draft: a resubmit returns the existing action instead of creating a duplicate
 * Gmail draft (retries go through `retryOwnerGmailDraft`).
 */
export async function createOwnerGmailDraft(
  input: GmailDraftWriteRequest,
): Promise<OwnerGmailDraftResult> {
  const { ownerUserId, approval, personId } = await prepareApprovedGmailWrite(input);
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
 * Update the existing Gmail draft linked to a revised Tendnote draft (ADR-0088).
 * Requires the same current user intent as create (an explicit call from the active
 * flow): editing the Tendnote draft alone never updates Gmail. Targets the STORED
 * Gmail draft id so no duplicate is created; a fresh idempotency key per submission
 * lets each explicit revision update, while the service records durable version
 * state. Duplicate-avoidance comes from the service targeting the stored id — never
 * from the key — so a stable key is deliberately NOT used here.
 */
export async function updateOwnerGmailDraft(
  input: GmailDraftWriteRequest,
): Promise<OwnerGmailDraftResult> {
  const { ownerUserId, approval, personId } = await prepareApprovedGmailWrite(input);
  const outcome = await gmailService().updateGmailDraft({
    ownerUserId,
    messageDraftId: input.draftId,
    subject: approval.subject,
    recipient: approval.recipient,
    idempotencyKey: `update:${input.draftId}:${randomUUID()}`,
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
