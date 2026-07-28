import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductRateLimitError } from "@/lib/rate-limit/errors";
import {
  enforceProductBudgetSpy,
  revalidatePathSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const { generateDraft } = vi.hoisted(() => ({
  generateDraft: vi.fn(),
}));

vi.mock("@tendnote/db/queries/drafts", () => ({ generateDraft }));

import { createDraftAction } from "./create-draft";

const PERSON_ID = randomUUID();
const FOLLOWUP_ID = randomUUID();
const BRIEF_ITEM_ID = randomUUID();
const DRAFT_ID = randomUUID();

beforeEach(() => {
  generateDraft.mockReset();
  revalidatePathSpy.mockReset();
  updateTagSpy.mockReset();
  enforceProductBudgetSpy.mockReset();
});

describe("createDraftAction", () => {
  function createdOutcome() {
    return {
      result: {
        status: "created",
        draft: { id: DRAFT_ID, personId: PERSON_ID },
      },
      affectedScopes: [{ kind: "owner-collection", collection: "people", ownerUserId: "owner-1" }],
    };
  }

  it("passes explicit follow-up context to the shared generator and routes on success", async () => {
    generateDraft.mockResolvedValue(createdOutcome());

    const result = await createDraftAction({
      personId: PERSON_ID,
      followupContext: { id: FOLLOWUP_ID, reason: "check in after the move" },
    });

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        personId: PERSON_ID,
        followupContext: { id: FOLLOWUP_ID, reason: "check in after the move" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      view: { outcome: "created", personId: PERSON_ID, draftId: DRAFT_ID },
    });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("passes explicit brief-item context", async () => {
    generateDraft.mockResolvedValue(createdOutcome());

    await createDraftAction({
      personId: PERSON_ID,
      briefItemContext: {
        id: BRIEF_ITEM_ID,
        title: "Reconnect with Mark",
        reason: "It's been a while",
      },
    });

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        briefItemContext: {
          id: BRIEF_ITEM_ID,
          title: "Reconnect with Mark",
          reason: "It's been a while",
        },
      }),
    );
  });

  it("passes the person entry-point purpose through to the generator", async () => {
    generateDraft.mockResolvedValue(createdOutcome());

    // The person-page entry point starts a check-in with no follow-up/brief context.
    await createDraftAction({ personId: PERSON_ID, purpose: "check_in" });

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: PERSON_ID,
        purpose: "check_in",
        followupContext: undefined,
        briefItemContext: undefined,
      }),
    );
  });

  it("returns a skipped outcome without a draft when generation is skipped", async () => {
    generateDraft.mockResolvedValue({
      result: { status: "skipped", reason: "insufficient_context" },
      affectedScopes: [],
    });

    const result = await createDraftAction({ personId: PERSON_ID });

    expect(result).toEqual({
      ok: true,
      view: { outcome: "skipped", personId: PERSON_ID, draftId: null },
    });
    // No routing/revalidation for a draft that wasn't created.
    expect(revalidatePathSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid person id", async () => {
    await expect(createDraftAction({ personId: "not-a-uuid" })).resolves.toMatchObject({
      ok: false,
    });
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it("charges the product budget and does not generate when the limit is exceeded", async () => {
    enforceProductBudgetSpy.mockRejectedValueOnce(
      new ProductRateLimitError({
        allowed: false,
        limit: 1,
        count: 2,
        remaining: 0,
        resetAt: new Date("2026-07-28T03:00:00Z"),
        costCategory: "server-action",
        reason: "limit_exceeded",
      }),
    );

    await expect(createDraftAction({ personId: PERSON_ID })).resolves.toEqual({
      ok: false,
      error: "You've reached a usage limit for this action. Please try again shortly.",
    });
    expect(enforceProductBudgetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "owner-1", costCategory: "server-action" }),
    );
    expect(generateDraft).not.toHaveBeenCalled();
  });
});
