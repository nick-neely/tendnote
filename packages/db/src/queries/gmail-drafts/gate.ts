import {
  GMAIL_CAPABILITY_KEY,
  GMAIL_PROVIDER_KEY,
  type MessageDraftStatus,
} from "@tendnote/domain";
import type { GmailDraftAuthorize } from "./types";

/**
 * Dependencies for the shared Gmail write gate. Injected so the same policy runs
 * over any connection/draft store (drizzle in production, fakes in tests).
 */
export type GmailApprovalGateDeps = {
  isConnected: (ref: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<boolean>;
  getDraftStatus: (input: {
    ownerUserId: string;
    draftId: string;
  }) => Promise<MessageDraftStatus | null>;
};

/**
 * The single Gmail write precondition gate (ADR-0083, ADR-0090, ADR-0092): the
 * `google/gmail` capability must be connected and the Tendnote draft must be
 * APPROVED. Both the web UI and Eve compose their Gmail draft service with this one
 * gate, so external-write approval policy can never fork between chat and web. It
 * returns a `blocked` reason (never throws) so a precondition failure leaves the
 * Tendnote draft intact and surfaces an explainable message.
 */
export function createGmailApprovalGate(deps: GmailApprovalGateDeps): GmailDraftAuthorize {
  return async (input) => {
    const connected = await deps.isConnected({
      ownerUserId: input.ownerUserId,
      providerKey: GMAIL_PROVIDER_KEY,
      capabilityKey: GMAIL_CAPABILITY_KEY,
    });
    if (!connected) {
      return { ok: false, reason: "Gmail isn't connected." };
    }

    const status = await deps.getDraftStatus({
      ownerUserId: input.ownerUserId,
      draftId: input.messageDraftId,
    });
    if (!status) {
      return { ok: false, reason: "That draft no longer exists." };
    }
    if (status !== "approved") {
      return { ok: false, reason: "Approve the Tendnote draft before saving it to Gmail." };
    }

    return { ok: true };
  };
}
