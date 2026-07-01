import { randomUUID } from "node:crypto";
import type {
  GmailDraftAdapter,
  GmailDraftAdapterCreateInput,
  GmailDraftAdapterUpdateInput,
} from "./types";

export type FakeGmailDraftAdapter = GmailDraftAdapter & {
  /** Create inputs the adapter was called with, for assertions. */
  createCalls: GmailDraftAdapterCreateInput[];
  /** Update inputs the adapter was called with, for assertions. */
  updateCalls: GmailDraftAdapterUpdateInput[];
};

/**
 * Deterministic fake Gmail draft adapter for normal tests (ADR-0097): never calls
 * Google. Create mints a stable-per-call draft id; update echoes the target id.
 * Records every call so tests can assert the minimized create/update request shape
 * without live Google credentials.
 */
export function createFakeGmailDraftAdapter(
  options: { draftId?: string } = {},
): FakeGmailDraftAdapter {
  const createCalls: GmailDraftAdapterCreateInput[] = [];
  const updateCalls: GmailDraftAdapterUpdateInput[] = [];

  return {
    createCalls,
    updateCalls,
    async createDraft(input) {
      createCalls.push(input);
      return { gmailDraftId: options.draftId ?? `gmail-draft-${randomUUID()}` };
    },
    async updateDraft(input) {
      updateCalls.push(input);
      return { gmailDraftId: input.gmailDraftId };
    },
  };
}

/** Fake adapter whose writes always fail — for exercising visible retry (ADR-0091). */
export function createFailingGmailDraftAdapter(
  error: Error = new Error("gmail draft write failed"),
): GmailDraftAdapter {
  return {
    async createDraft() {
      throw error;
    },
    async updateDraft() {
      throw error;
    },
  };
}
