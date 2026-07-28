"use server";

import type { GmailDraftActionOutcome } from "@tendnote/db/queries/gmail-drafts";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
import { z } from "zod";
import { type GmailDraftView, toGmailDraftView } from "@/lib/gmail-draft-view";
import {
  createOwnerGmailDraft,
  retryOwnerGmailDraft,
  updateOwnerGmailDraft,
} from "@/lib/integrations/gmail-drafts";
import { runOwnerAction } from "@/lib/owner-action";

const recipientSchema = z.object({
  email: z.string().trim().min(3).max(320),
  source: z.enum(["contact_method", "manual_entry"]),
  contactMethodId: z.string().min(1).nullable().default(null),
});

/** Shared input shape for both the create and update Gmail write actions. */
const gmailDraftInputSchema = z.object({
  draftId: z.uuid(),
  subject: z.string().trim().min(1),
  recipient: recipientSchema,
  bodyEdit: z.string().optional(),
});

type GmailDraftInput = {
  draftId: string;
  subject: string;
  recipient: {
    email: string;
    source: "contact_method" | "manual_entry";
    contactMethodId?: string | null;
  };
  bodyEdit?: string;
};

const retrySchema = z.object({ draftId: z.uuid(), actionId: z.uuid() });

/**
 * Result the draft card renders: the inline Gmail state on success/failure, or a
 * blocked reason (Gmail not connected, draft not approved) so the card can explain
 * why nothing was written. Never claims a message was sent (ADR-0089).
 */
export type GmailDraftActionResult =
  | { status: "succeeded" | "failed"; view: GmailDraftView }
  | { status: "blocked"; reason: string };

function toResult(outcome: GmailDraftActionOutcome): GmailDraftActionResult {
  if (outcome.status === "blocked") {
    return { status: "blocked", reason: outcome.reason };
  }
  return { status: outcome.status, view: toGmailDraftView(outcome.action) };
}

/** Validate the shared input and run one owner-scoped Gmail write to a UI result. */
function runGmailWrite(input: GmailDraftInput, write: typeof createOwnerGmailDraft) {
  return runOwnerAction({
    schema: gmailDraftInputSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      write({
        ownerUserId,
        draftId: parsed.draftId,
        subject: parsed.subject,
        recipient: parsed.recipient,
        bodyEdit: parsed.bodyEdit,
      }),
    affectedScopes: (result, ownerUserId) => [
      ...result.affectedScopes,
      ...(result.personId
        ? affectedScopesForPerson({ ownerUserId, personId: result.personId })
        : []),
    ],
    result: ({ outcome }) => toResult(outcome),
  });
}

/**
 * Create a Gmail draft from an approved Tendnote draft through the shared approval
 * gate. Persists last-mile body edits through the Tendnote draft first; never sends.
 */
export async function createGmailDraftAction(input: GmailDraftInput) {
  return runGmailWrite(input, createOwnerGmailDraft);
}

/**
 * Update the Gmail draft linked to a revised Tendnote draft (ADR-0088). Explicit
 * user intent only — editing the draft alone never updates Gmail — and targets the
 * existing Gmail draft id rather than creating a duplicate.
 */
export async function updateGmailDraftAction(input: GmailDraftInput) {
  return runGmailWrite(input, updateOwnerGmailDraft);
}

/** Explicitly retry a failed Gmail draft write (visible retry only, no background). */
export async function retryGmailDraftAction(input: { draftId: string; actionId: string }) {
  return runOwnerAction({
    schema: retrySchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      retryOwnerGmailDraft({
        ownerUserId,
        draftId: parsed.draftId,
        actionId: parsed.actionId,
      }),
    affectedScopes: (result, ownerUserId) => [
      ...result.affectedScopes,
      ...(result.personId
        ? affectedScopesForPerson({ ownerUserId, personId: result.personId })
        : []),
    ],
    result: ({ outcome }) => toResult(outcome),
  });
}
