import { createDrizzleDraftStore } from "./drafts/drizzle-store";
import { createDrizzleGmailDraftActionStore } from "./gmail-drafts/drizzle-store";
import { createGmailDraftService, type GmailDraftServiceDeps } from "./gmail-drafts/service";
import type { GmailDraftAdapter, GmailDraftBodySource } from "./gmail-drafts/types";

export { createDrizzleGmailDraftActionStore } from "./gmail-drafts/drizzle-store";
export {
  createFailingGmailDraftAdapter,
  createFakeGmailDraftAdapter,
  type FakeGmailDraftAdapter,
} from "./gmail-drafts/fake-adapter";
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
