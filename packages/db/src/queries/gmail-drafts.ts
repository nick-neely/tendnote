import { createDrizzleDraftStore } from "./drafts/drizzle-store";
import { createDrizzleBetterAuthGoogleGmailAccessTokenProvider } from "./gmail-drafts/access-token";
import { createDrizzleGmailDraftActionStore } from "./gmail-drafts/drizzle-store";
import { createGoogleGmailDraftAdapter } from "./gmail-drafts/google-adapter";
import { createGmailDraftService, type GmailDraftServiceDeps } from "./gmail-drafts/service";
import type { GmailDraftAdapter, GmailDraftBodySource } from "./gmail-drafts/types";

export {
  type BetterAuthGoogleAccountToken,
  createBetterAuthGoogleGmailAccessTokenProvider,
  createDrizzleBetterAuthGoogleGmailAccessTokenProvider,
  type GoogleGmailAccessTokenProvider,
  GoogleGmailAccessTokenUnavailableError,
} from "./gmail-drafts/access-token";
export { createDrizzleGmailDraftActionStore } from "./gmail-drafts/drizzle-store";
export {
  createFailingGmailDraftAdapter,
  createFakeGmailDraftAdapter,
  type FakeGmailDraftAdapter,
} from "./gmail-drafts/fake-adapter";
export {
  createGoogleGmailDraftAdapter,
  type GoogleGmailAdapterOptions,
} from "./gmail-drafts/google-adapter";
export type { InMemoryGmailDraftActionStore } from "./gmail-drafts/in-memory-store";
export { createInMemoryGmailDraftActionStore } from "./gmail-drafts/in-memory-store";
export {
  createGmailDraftService,
  type GmailDraftActionOutcome,
  type GmailDraftRetryInput,
  type GmailDraftService,
  type GmailDraftServiceDeps,
  type GmailDraftWriteInput,
} from "./gmail-drafts/service";
export type * from "./gmail-drafts/types";

// Default owner-scoped read of a draft's Gmail action history for inline state
// (ADR-0096). Read-only — no adapter or gate — so surfaces can render "saved in
// Gmail" / failed state without going through the write service.
const defaultGmailDraftActionStore = createDrizzleGmailDraftActionStore();

/** An owner's Gmail draft actions for one Tendnote draft, newest first (ADR-0096). */
export function listGmailDraftActionsForDraft(input: {
  ownerUserId: string;
  messageDraftId: string;
}) {
  return defaultGmailDraftActionStore.listActionsForDraft(input);
}

/**
 * The Tendnote draft body source of truth (ADR-0086): the Gmail write reads the
 * exact persisted draft body, so approval-flow edits must already be written
 * through the draft lifecycle. Reuses the shared drizzle draft store rather than
 * forking draft reads.
 */
export function createDrizzleGmailDraftBodySource(): GmailDraftBodySource {
  const draftStore = createDrizzleDraftStore();
  return {
    async getDraftBody(input) {
      const draft = await draftStore.getDraft({
        ownerUserId: input.ownerUserId,
        draftId: input.messageDraftId,
      });
      return draft ? { body: draft.body } : null;
    },
  };
}

/**
 * Build the default owner-scoped Gmail draft service against the durable drizzle
 * action store and the shared draft body source, with the Gmail adapter and
 * precondition gate injected by the caller (web #122 / Eve #124), so this shared
 * seam never reaches for Google credentials or forks approval policy itself.
 */
export function createDefaultGmailDraftService(
  adapter: GmailDraftAdapter,
  options?: Partial<Omit<GmailDraftServiceDeps, "adapter">>,
) {
  return createGmailDraftService({
    adapter,
    store: options?.store ?? createDrizzleGmailDraftActionStore(),
    drafts: options?.drafts ?? createDrizzleGmailDraftBodySource(),
    authorize: options?.authorize,
  });
}

/**
 * The default Gmail draft service backed by the live Google Gmail draft adapter,
 * reading the owner's Better Auth Google token. The precondition gate (connected
 * `google/gmail` capability + approved Tendnote draft) is injected by the caller
 * so the connection/approval policy composes at the product boundary (#122).
 */
export function createDefaultGoogleGmailDraftService(
  options?: Partial<Omit<GmailDraftServiceDeps, "adapter">>,
) {
  return createDefaultGmailDraftService(
    createGoogleGmailDraftAdapter({
      getAccessToken: createDrizzleBetterAuthGoogleGmailAccessTokenProvider(),
    }),
    options,
  );
}
