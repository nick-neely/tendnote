import type { GmailDraftAction } from "@tendnote/domain";

/**
 * Serializable inline view of a Tendnote draft's Gmail state (ADR-0096). Shows only
 * the last known external-draft state — never a raw provider payload — so the draft
 * card can render "saved in Gmail" or a visible retry without a separate Gmail page.
 */
export type GmailDraftView = {
  actionId: string;
  status: "succeeded" | "failed";
  kind: "create" | "update";
  gmailDraftId: string | null;
  subject: string;
  recipientEmail: string;
  /** Non-secret error for the visible retry affordance; null on success. */
  error: string | null;
};

export function toGmailDraftView(action: GmailDraftAction): GmailDraftView {
  return {
    actionId: action.id,
    status: action.status,
    kind: action.kind,
    gmailDraftId: action.gmailDraftId,
    subject: action.subject,
    recipientEmail: action.recipient.email,
    error: action.lastErrorMessage,
  };
}

/** Project a draft's action history (newest first) to its inline Gmail state. */
export function latestGmailDraftView(actions: GmailDraftAction[]): GmailDraftView | null {
  const latest = actions[0];
  return latest ? toGmailDraftView(latest) : null;
}
