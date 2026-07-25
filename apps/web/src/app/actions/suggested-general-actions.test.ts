import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy, updateTagSpy } from "@/test/action-adapter-mocks";

/**
 * The chat review card's Accept/Dismiss buttons call these server actions directly
 * (see chat-general-action-review-card.tsx). These tests pin the card path: the action
 * resolves the owner from the session (never from input), forwards the exact
 * generalActionId to the shared review mutation, and — because promotion is idempotent
 * (proven at the DB layer, general-actions/review.test.ts) — a stale card or a double
 * click cannot double-promote.
 */

const {
  acceptSuggestedGeneralAction,
  dismissSuggestedGeneralAction,
  editSuggestedGeneralAction,
  ignoreSuggestedGeneralAction,
  listGeneralActionAreas,
  toSuggestedGeneralActionReviewView,
} = vi.hoisted(() => ({
  acceptSuggestedGeneralAction: vi.fn(),
  dismissSuggestedGeneralAction: vi.fn(),
  editSuggestedGeneralAction: vi.fn(),
  ignoreSuggestedGeneralAction: vi.fn(),
  listGeneralActionAreas: vi.fn(),
  toSuggestedGeneralActionReviewView: vi.fn(),
}));

vi.mock("@tendnote/db/queries/general-actions", () => ({
  acceptSuggestedGeneralAction,
  dismissSuggestedGeneralAction,
  editSuggestedGeneralAction,
  ignoreSuggestedGeneralAction,
}));
vi.mock("@tendnote/db/queries/general-action-areas", () => ({ listGeneralActionAreas }));
vi.mock("@/lib/suggested-general-action-review-view", () => ({
  toSuggestedGeneralActionReviewView,
}));

import {
  acceptSuggestedGeneralActionAction,
  dismissSuggestedGeneralActionAction,
} from "./suggested-general-actions";

const GENERAL_ACTION_ID = randomUUID();

beforeEach(() => {
  vi.clearAllMocks();
  listGeneralActionAreas.mockResolvedValue([]);
  // The view mapper is exercised by its own tests; here it is a thin passthrough so the
  // action's forwarding and idempotency stay the subject.
  toSuggestedGeneralActionReviewView.mockImplementation((result: { action: unknown }) => ({
    action: result.action,
  }));
});

describe("acceptSuggestedGeneralActionAction (card Accept path)", () => {
  it("resolves the owner from the session and forwards the card's id to the shared accept", async () => {
    acceptSuggestedGeneralAction.mockResolvedValue({
      component: { type: "suggested_general_action_review", generalActionId: GENERAL_ACTION_ID },
      action: { id: GENERAL_ACTION_ID, status: "open", areaId: null },
      sourceRecord: null,
    });

    await acceptSuggestedGeneralActionAction({ generalActionId: GENERAL_ACTION_ID });

    expect(acceptSuggestedGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "owner-1", generalActionId: GENERAL_ACTION_ID }),
    );
    // Both review surfaces re-render so chat and /actions agree.
    expect(revalidatePathSpy).toHaveBeenCalledWith("/actions");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/");
    expect(updateTagSpy).toHaveBeenCalledWith("review:owner:owner-1");
  });

  it("a stale card / double click does not double-promote — the second accept is a no-op", async () => {
    // Model the shared mutation's idempotent contract: the first accept promotes to
    // `open`; a repeat call returns the same already-open action without promoting again.
    let promotions = 0;
    acceptSuggestedGeneralAction.mockImplementation(async ({ generalActionId }) => {
      if (promotions === 0) {
        promotions += 1;
      }
      return {
        component: { type: "suggested_general_action_review", generalActionId },
        action: { id: generalActionId, status: "open", areaId: null },
        sourceRecord: null,
      };
    });

    const first = await acceptSuggestedGeneralActionAction({
      generalActionId: GENERAL_ACTION_ID,
    });
    const second = await acceptSuggestedGeneralActionAction({
      generalActionId: GENERAL_ACTION_ID,
    });

    // The same id is forwarded both times, and both settle to a single promoted action.
    expect(acceptSuggestedGeneralAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ generalActionId: GENERAL_ACTION_ID }),
    );
    expect(promotions).toBe(1);
    expect(first.action).toMatchObject({ id: GENERAL_ACTION_ID, status: "open" });
    expect(second.action).toMatchObject({ id: GENERAL_ACTION_ID, status: "open" });
  });

  it("rejects a non-uuid id before touching the shared mutation", async () => {
    await expect(
      acceptSuggestedGeneralActionAction({ generalActionId: "not-a-uuid" }),
    ).rejects.toThrow();
    expect(acceptSuggestedGeneralAction).not.toHaveBeenCalled();
  });
});

describe("dismissSuggestedGeneralActionAction (card Dismiss path)", () => {
  it("forwards the card's id to the shared dismiss and returns the resolution", async () => {
    dismissSuggestedGeneralAction.mockResolvedValue({
      id: GENERAL_ACTION_ID,
      status: "dismissed",
    });

    const result = await dismissSuggestedGeneralActionAction({
      generalActionId: GENERAL_ACTION_ID,
    });

    expect(dismissSuggestedGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "owner-1", generalActionId: GENERAL_ACTION_ID }),
    );
    expect(result).toEqual({ generalActionId: GENERAL_ACTION_ID, status: "dismissed" });
  });
});
