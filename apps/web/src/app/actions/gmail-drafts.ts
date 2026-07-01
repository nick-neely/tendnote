"use server";

import type { GmailDraftActionOutcome } from "@tendnote/db/queries/gmail-drafts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type GmailDraftView, toGmailDraftView } from "@/lib/gmail-draft-view";
import { createOwnerGmailDraft, retryOwnerGmailDraft } from "@/lib/integrations/gmail-drafts";

const recipientSchema = z.object({
  email: z.string().trim().min(3).max(320),
  source: z.enum(["contact_method", "manual_entry"]),
  contactMethodId: z.string().min(1).nullable().default(null),
});

const createSchema = z.object({
  draftId: z.uuid(),
  subject: z.string().trim().min(1),
  recipient: recipientSchema,
  bodyEdit: z.string().optional(),
});

const retrySchema = z.object({ draftId: z.uuid(), actionId: z.uuid() });

/**
 * Result the draft card renders: the inline Gmail state on success/failure, or a
 * blocked reason (Gmail not connected, draft not approved) so the card can explain
 * why nothing was written. Never claims a message was sent (ADR-0089).
 */
export type GmailDraftActionResult =
  | { status: "succeeded" | "failed"; view: GmailDraftView }
  | { status: "blocked"; reason: string };

function toResult(
  outcome: GmailDraftActionOutcome,
  personId: string | null,
): GmailDraftActionResult {
  if (outcome.status === "blocked") {
    return { status: "blocked", reason: outcome.reason };
  }
  if (personId) {
    revalidatePath(`/people/${personId}`);
  }
  return { status: outcome.status, view: toGmailDraftView(outcome.action) };
}

/**
 * Create a Gmail draft from an approved Tendnote draft through the shared approval
 * gate. Persists last-mile body edits through the Tendnote draft first; never sends.
 */
export async function createGmailDraftAction(input: {
  draftId: string;
  subject: string;
  recipient: {
    email: string;
    source: "contact_method" | "manual_entry";
    contactMethodId?: string | null;
  };
  bodyEdit?: string;
}): Promise<GmailDraftActionResult> {
  const parsed = createSchema.parse(input);
  const { outcome, personId } = await createOwnerGmailDraft({
    draftId: parsed.draftId,
    subject: parsed.subject,
    recipient: parsed.recipient,
    bodyEdit: parsed.bodyEdit,
  });
  return toResult(outcome, personId);
}

/** Explicitly retry a failed Gmail draft write (visible retry only, no background). */
export async function retryGmailDraftAction(input: {
  draftId: string;
  actionId: string;
}): Promise<GmailDraftActionResult> {
  const parsed = retrySchema.parse(input);
  const { outcome, personId } = await retryOwnerGmailDraft({
    draftId: parsed.draftId,
    actionId: parsed.actionId,
  });
  return toResult(outcome, personId);
}
