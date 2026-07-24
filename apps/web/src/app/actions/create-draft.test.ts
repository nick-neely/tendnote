import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateDraft, revalidatePath, updateTag, enforceProductBudget } = vi.hoisted(() => ({
  generateDraft: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  enforceProductBudget: vi.fn(),
}));

vi.mock("@tendnote/db/queries/drafts", () => ({ generateDraft }));
vi.mock("next/cache", () => ({ revalidatePath, updateTag }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("user-1"),
}));
vi.mock("@/lib/rate-limit/guards", () => ({ enforceProductBudget }));

import { createDraftAction } from "./create-draft";

const PERSON_ID = randomUUID();
const FOLLOWUP_ID = randomUUID();
const BRIEF_ITEM_ID = randomUUID();
const DRAFT_ID = randomUUID();

beforeEach(() => {
  generateDraft.mockReset();
  revalidatePath.mockReset();
  updateTag.mockReset();
  enforceProductBudget.mockReset();
});

describe("createDraftAction", () => {
  it("passes explicit follow-up context to the shared generator and routes on success", async () => {
    generateDraft.mockResolvedValue({
      status: "created",
      draft: { id: DRAFT_ID, personId: PERSON_ID },
    });

    const result = await createDraftAction({
      personId: PERSON_ID,
      followupContext: { id: FOLLOWUP_ID, reason: "check in after the move" },
    });

    expect(generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        personId: PERSON_ID,
        followupContext: { id: FOLLOWUP_ID, reason: "check in after the move" },
      }),
    );
    expect(result).toEqual({ outcome: "created", personId: PERSON_ID, draftId: DRAFT_ID });
    expect(revalidatePath).toHaveBeenCalledWith(`/people/${PERSON_ID}`);
    expect(updateTag).toHaveBeenCalledWith(`people:owner:user-1:person:${PERSON_ID}`);
  });

  it("passes explicit brief-item context", async () => {
    generateDraft.mockResolvedValue({
      status: "created",
      draft: { id: DRAFT_ID, personId: PERSON_ID },
    });

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
    generateDraft.mockResolvedValue({
      status: "created",
      draft: { id: DRAFT_ID, personId: PERSON_ID },
    });

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
    generateDraft.mockResolvedValue({ status: "skipped", reason: "insufficient_context" });

    const result = await createDraftAction({ personId: PERSON_ID });

    expect(result).toEqual({ outcome: "skipped", personId: PERSON_ID, draftId: null });
    // No routing/revalidation for a draft that wasn't created.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid person id", async () => {
    await expect(createDraftAction({ personId: "not-a-uuid" })).rejects.toThrow();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it("charges the product budget and does not generate when the limit is exceeded", async () => {
    enforceProductBudget.mockRejectedValueOnce(new Error("rate limited"));

    await expect(createDraftAction({ personId: PERSON_ID })).rejects.toThrow();
    expect(enforceProductBudget).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user-1", costCategory: "server-action" }),
    );
    expect(generateDraft).not.toHaveBeenCalled();
  });
});
